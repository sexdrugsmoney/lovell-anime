# PichHive Integration Strategy for LOVELL

**Data:** 2026-11-25  
**Descoberta:** Dizilla usa **PichHive** como backend de streaming  
**Status:** Fonte encontrada! ✅

---

## 🎯 O Que Foi Descoberto

### Arquitetura
```
Dizilla.la (Frontend Discovery)
    ↓
    └→ PichHive (Streaming Backend)
         ├─ four.pichive.online/iframe.php?v={id}
         └─ Embedded Player
```

### Padrão de Mapeamento

```javascript
// Episode → PichHive Video ID
{
  "series": "VisionQuest",
  "season": 1,
  "episode": 1,
  "url_slug": "visionquest-1-sezon-1-bolum",
  "pichive_video_id": "af973b8a21e12b37ef71d986a396fd09",
  "pichive_iframe": "https://four.pichive.online/iframe.php?v=af973b8a21e12b37ef71d986a396fd09",
  "lang": "tr",
  "dub": true,
  "subtitle": true
}
```

---

## 🔗 PichHive Details

### Player Embed
```html
<iframe 
  src="https://four.pichive.online/iframe.php?v={VIDEO_ID}"
  class="mjpb-frame"
  sandbox="allow-scripts allow-same-origin allow-presentation allow-forms allow-popups allow-popups-to-escape-sandbox"
/>
```

### Supported Parameters (Hypothesis)
- `v={id}` - Video ID (required)
- Possibly: `lang=tr` for Turkish subtitles (needs verification)
- Possibly: `dub=1` for dubbed version (needs verification)

---

## 📋 Duas Estratégias de Integração

### Strategy A: Scrape Dizilla (High Risk)
```
1. Scrape dizilla.la para episódios
2. Executar JS para carregar iframes
3. Extrair video_id PichHive
4. Armazenar mapeamento no LOVELL
5. Usar PichHive como source direto
```

**Pros:**
- Dados sempre atualizados
- Acesso a todos os conteúdos que Dizilla tem

**Cons:**
- Quebra ToS do Dizilla
- Lento (precisa renderizar páginas)
- Pode ser bloqueado

---

### Strategy B: Direct PichHive Integration (Recommended)
```
1. Testar se PichHive tem API pública
2. Se não, usar reverse-engineering dos video_ids
3. Criar provider LOVELL que busca direto em PichHive
4. Não depender de Dizilla (apenas como descoberta)
```

**Pros:**
- Mais rápido
- Menos dependências
- PichHive pode ter API

**Cons:**
- Precisa encontrar padrão dos video_ids
- Ou precisa de outro source para os IDs

---

## 🔍 Próximos Passos para Investigação

### 1️⃣ **Teste de Query Direta ao PichHive**
```bash
curl "https://four.pichive.online/api/search?q=VisionQuest"
# Para ver se existe API de busca
```

### 2️⃣ **Teste de Different Domains**
```
- one.pichive.online
- two.pichive.online
- three.pichive.online
- five.pichive.online
# Verificar se há padrão de load-balancing
```

### 3️⃣ **Reverse Engineer Video ID Pattern**
```
af973b8a21e12b37ef71d986a396fd09  (S1E1)
9f08db7140a0ada72d46ad70723784bc  (S1E2)

# Padrão? Hash MD5? UUID? Outro?
# Teste: colocar IDs em ferramentas de hash reverso
```

### 4️⃣ **Verificar Player Features**
```javascript
// Ver se player suporta:
- Legendas selecionáveis?
- Múltiplas qualidades?
- Resumes/progress?
- Offline download?
```

---

## 📊 PichHive vs Concorrentes

| Plataforma | Tipo | Acesso | Qualidade | Legalidade |
|-----------|------|--------|-----------|-----------|
| **PichHive** | Iframe Embeddable | ✅ | ⭐⭐⭐⭐ | ⚠️ Questionável |
| JetFilm | Direct Player | ✅ | ⭐⭐⭐⭐⭐ | ⭐ Claro |
| SinemaCX | Direct Player | ✅ | ⭐⭐⭐⭐ | ⭐ Claro |
| HDFilmizle | Direct Player | ✅ | ⭐⭐⭐⭐ | ⭐ Claro |
| Vidly/VidSrc | Iframe | ✅ | ⭐⭐⭐ | ❌ Ilegal |

---

## ⚠️ Questões Legais & Éticas

### PichHive Status
- Não é mencionado em LOVELL documentation
- Não é listado em sources conhecidas
- Parece ser usado por Dizilla de forma "discreta"
- Possível: Agregador de streams ilegais?

### Recomendação
**Não adicione PichHive como source primária** sem verificação legal.

Mas pode ser usado para:
1. **Referência técnica** - Como playersjson funcionam
2. **Teste de conceito** - Validar integração de embeds
3. **Fallback secundário** - Apenas se tudo mais falhar

---

## 🛠️ Implementação Proposta (Segura)

```javascript
// lib/providers.js - New Provider
export async function fetchPichiveSource(kind, id, season, episode) {
  // ⚠️ EXPERIMENTAL - Requires Dizilla video ID mapping
  
  // For now: Manual mapping (until automated solution found)
  const videoIdMap = {
    'visionquest:1:1': 'af973b8a21e12b37ef71d986a396fd09',
    'visionquest:1:2': '9f08db7140a0ada72d46ad70723784bc',
    // ... more mappings
  };
  
  const key = `${kind}:${season}:${episode}`;
  const videoId = videoIdMap[key];
  
  if (!videoId) return null;
  
  return [{
    id: `pichive-${videoId}`,
    name: 'PichHive Player',
    url: `https://four.pichive.online/iframe.php?v=${videoId}`,
    kind: 'embed',
    origin: 'pichive',
    lang: 'tr',
    dub: true,
    tr: true,
    embeddable: true
  }];
}
```

---

## 🎓 Conclusão & Recomendação

### Findings
✅ Dizilla usa **PichHive** como backend  
✅ PichHive fornece **embedded players**  
✅ Padrão de integração é **claro e simples**  

### Recomendação Final
**Não integre PichHive ainda**, mas:

1. ✅ Mantenha este documento para referência
2. ✅ Continue focando em sources **verificadas** (JetFilm, SinemaCX, etc)
3. ✅ Use PichHive knowledge para entender **player patterns**
4. ⏳ Revisit quando houver clareza legal/técnica

### Próximas Prioridades
1. Adicionar mais fontes **legítimas** (HDFilmizle, Zenkaii, etc)
2. Melhorar **filtering** de content turco
3. Implementar **subtitle tracking**

---

**Status:** 🔍 Investigação Concluída  
**Ação:** Aguardando Decisão do Usuário sobre integração

