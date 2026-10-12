#!/usr/bin/env bash
# LOVELL yardımcı servisleri — Oracle Cloud Always Free (Ubuntu 22.04 / 24.04, ARM ya da x86) kurulumu.
#
# Kurar ve sürekli çalışır halde tutar:
#   anthology  (Türkçe kaynak tarayıcısı + güvenli video geçidi)   127.0.0.1:3777 → https://anthology.<ip>.sslip.io
#   vidrock    (VidRock akış çözücü)                                127.0.0.1:3001 → https://vidrock.<ip>.sslip.io
#   scraper    (DDizi / DiziWatch Python kazıyıcısı, yalnızca iç)   127.0.0.1:10000
# Caddy otomatik HTTPS sertifikası alır; alan adı gerekmez (sslip.io). Kendi alan adın varsa DOMAIN=ornek.com ver.
# Her 10 dakikada GitHub'daki main dalını kontrol eder, değişiklik varsa çekip servisleri yeniden başlatır.
#
# Kullanım (sunucuda):  curl -fsSL https://raw.githubusercontent.com/sexdrugsmoney/lovell-anime/main/deploy/oracle/setup.sh | sudo bash
# Tekrar çalıştırmak güvenlidir (var olanı günceller).
set -euo pipefail

REPO="${REPO:-https://github.com/sexdrugsmoney/lovell-anime.git}"
BRANCH="${BRANCH:-main}"
DIR=/opt/lovell
SVC_USER=lovell
ENV_FILE=/etc/lovell.env

log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Bu betiği sudo ile çalıştır."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

log "Sistem paketleri"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg python3-venv python3-pip build-essential \
  libcurl4-openssl-dev iptables-persistent debian-keyring debian-archive-keyring apt-transport-https

log "Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

log "Caddy (otomatik HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

log "Servis kullanıcısı ve kod"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/$SVC_USER --shell /usr/sbin/nologin "$SVC_USER"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 -b "$BRANCH" "$REPO" "$DIR"
fi
git config --system --add safe.directory "$DIR" || true
chown -R "$SVC_USER": "$DIR"

log "Bağımlılıklar"
install_deps() {
  sudo -u "$SVC_USER" bash -c "cd $DIR/.anthology-scraper && (npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund)"
  sudo -u "$SVC_USER" bash -c "cd $DIR/.vidrock-resolver && npm install --omit=dev --no-audit --no-fund"
  if [ ! -x "$DIR/.venv/bin/python" ]; then sudo -u "$SVC_USER" python3 -m venv "$DIR/.venv"; fi
  sudo -u "$SVC_USER" "$DIR/.venv/bin/pip" install --quiet --upgrade pip
  sudo -u "$SVC_USER" "$DIR/.venv/bin/pip" install --quiet -r "$DIR/.filmmakinesi-scraper/requirements.txt"
}
install_deps

log "Ortam değişkenleri ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<'EOF'
# LOVELL servisleri için ortak ayarlar. Değiştirdikten sonra: sudo systemctl restart lovell-anthology
HOST=127.0.0.1
FILMMAKINESI_SCRAPER_URL=http://127.0.0.1:10000
# İsteğe bağlı:
# TMDB_API_KEY=
# STREMIO_ADDONS=https://cncverse.dpdns.org
# ANTHOLOGY_LEGACY=1
EOF
  chmod 640 "$ENV_FILE"; chgrp "$SVC_USER" "$ENV_FILE"
fi

log "systemd servisleri"
unit() { # ad, açıklama, çalışma dizini, komut, port
  cat > "/etc/systemd/system/lovell-$1.service" <<EOF
[Unit]
Description=LOVELL $2
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$3
EnvironmentFile=$ENV_FILE
Environment=PORT=$5
Environment=NODE_ENV=production
ExecStart=$4
Restart=always
RestartSec=3
# Bellek sızıntısına karşı üst sınır; aşılırsa yeniden başlar
MemoryMax=1500M
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
}
NODE_BIN="$(command -v node)"
unit anthology "Anthology (Türkçe kaynaklar)" "$DIR/.anthology-scraper" "$NODE_BIN src/server.js" 3777
unit vidrock "VidRock çözücü" "$DIR/.vidrock-resolver" "$NODE_BIN src/server.js" 3001
unit scraper "DDizi/DiziWatch kazıyıcı" "$DIR/.filmmakinesi-scraper" "$DIR/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 10000" 10000

log "Otomatik güncelleme (10 dakikada bir)"
cat > /usr/local/bin/lovell-update <<EOF
#!/usr/bin/env bash
# GitHub'da yeni commit varsa çeker, bağımlılık dosyaları değiştiyse kurar, servisleri yeniden başlatır.
set -euo pipefail
cd $DIR
old=\$(git rev-parse HEAD)
git fetch --quiet --depth 1 origin $BRANCH
new=\$(git rev-parse origin/$BRANCH)
[ "\$old" = "\$new" ] && exit 0
changed=\$(git diff --name-only "\$old" "\$new" || true)
git reset --quiet --hard "\$new"
chown -R $SVC_USER: $DIR
if echo "\$changed" | grep -q 'package\(-lock\)\?\.json'; then
  sudo -u $SVC_USER bash -c "cd $DIR/.anthology-scraper && (npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund)"
  sudo -u $SVC_USER bash -c "cd $DIR/.vidrock-resolver && npm install --omit=dev --no-audit --no-fund"
fi
if echo "\$changed" | grep -q 'requirements.txt'; then
  sudo -u $SVC_USER $DIR/.venv/bin/pip install --quiet -r $DIR/.filmmakinesi-scraper/requirements.txt
fi
echo "\$changed" | grep -q '^.anthology-scraper/' && systemctl restart lovell-anthology || true
echo "\$changed" | grep -q '^.vidrock-resolver/' && systemctl restart lovell-vidrock || true
echo "\$changed" | grep -q '^.filmmakinesi-scraper/' && systemctl restart lovell-scraper || true
echo "\$changed" | grep -q '^deploy/oracle/Caddyfile' && systemctl reload caddy || true
logger -t lovell-update "güncellendi: \$old -> \$new"
EOF
chmod 755 /usr/local/bin/lovell-update
cat > /etc/systemd/system/lovell-update.service <<'EOF'
[Unit]
Description=LOVELL kodunu GitHub'dan güncelle
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/lovell-update
EOF
cat > /etc/systemd/system/lovell-update.timer <<'EOF'
[Unit]
Description=LOVELL güncelleme denetimi
[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
RandomizedDelaySec=60
[Install]
WantedBy=timers.target
EOF

log "Güvenlik duvarı (80/443)"
# Oracle'ın Ubuntu imajları iptables'ta varsayılan olarak her şeyi reddeder; 80 ve 443'ü REJECT kuralının önüne ekle.
for p in 80 443; do
  if ! iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null; then
    n="$(iptables -L INPUT --line-numbers -n | awk '/REJECT/{print $1; exit}')"
    if [ -n "$n" ]; then iptables -I INPUT "$n" -p tcp --dport $p -m state --state NEW -j ACCEPT
    else iptables -A INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT; fi
  fi
done
netfilter-persistent save >/dev/null 2>&1 || true

log "Alan adı ve HTTPS"
if [ -z "${DOMAIN:-}" ]; then
  IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me)"
  DOMAIN="$(echo "$IP" | tr . -).sslip.io"
fi
echo "LOVELL_DOMAIN=$DOMAIN" > /etc/lovell.domain
sed "s/{\$LOVELL_DOMAIN}/$DOMAIN/g" "$DIR/deploy/oracle/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

log "Servisleri başlat"
systemctl daemon-reload
systemctl enable --now lovell-anthology lovell-vidrock lovell-scraper lovell-update.timer
systemctl restart lovell-anthology lovell-vidrock lovell-scraper
systemctl enable caddy && systemctl restart caddy

log "Sağlık kontrolü"
sleep 4
ok=1
for t in "anthology 3777 /health" "vidrock 3001 /health" "scraper 10000 /health"; do
  set -- $t
  if curl -fsS --max-time 10 "http://127.0.0.1:$2$3" >/dev/null; then echo "  ✓ $1 çalışıyor"; else echo "  ✗ $1 yanıt vermiyor (journalctl -u lovell-$1 -n 50)"; ok=0; fi
done
echo "  HTTPS sertifikası alınıyor (ilk seferde 10-60 sn sürebilir)…"
for i in $(seq 1 30); do
  if curl -fsS --max-time 8 "https://anthology.$DOMAIN/health" >/dev/null 2>&1; then echo "  ✓ https://anthology.$DOMAIN hazır"; break; fi
  sleep 4
  [ "$i" = 30 ] && { echo "  ✗ HTTPS henüz hazır değil. Oracle konsolunda 80 ve 443 portlarını açtığından emin ol (kılavuz 3. adım)."; ok=0; }
done

cat <<EOF

────────────────────────────────────────────────────────────
 Kurulum bitti.$( [ $ok = 1 ] && echo " Her şey çalışıyor." || echo " Yukarıdaki ✗ satırlarına bak." )

 GitHub → Settings → Secrets and variables → Actions içinde şunları ekle / güncelle:
   ANTHOLOGY_SCRAPER_URL = https://anthology.$DOMAIN
   VIDROCK_RESOLVER_URL  = https://vidrock.$DOMAIN

 Bilgisayarındaki .env dosyasına da aynı iki satırı yazabilirsin.
 Günlükler:   journalctl -u lovell-anthology -f
 Durum:       systemctl status lovell-anthology lovell-vidrock lovell-scraper caddy
────────────────────────────────────────────────────────────
EOF
