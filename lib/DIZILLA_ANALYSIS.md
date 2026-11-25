# Dizilla - Análise Detalhada para Integração LOVELL

**Data:** 2026-11-25  
**Site:** https://dizilla.la  
**Tipo:** Plataforma de Descoberta & Rastreamento de Séries Televisivas

---

## 📋 Resumo Executivo

Dizilla **NÃO é uma fonte de streaming direta**. É uma plataforma de descoberta e rastreamento de séries TV focada em audiência turca. Diferente de provedores como JetFilm ou SinemaCX, Dizilla:

- ✅ Agrega metadados sobre séries
- ✅ Categoriza séries por tipo de dublagem (Türkçe Dublaj, Yerli Dizi, Anime, etc)
- ✅ Rastreia disponibilidade de dublagem e legenda em turco
- ✅ Mostra informações de episódios e air dates
- ❌ **NÃO fornece players ou streams**
- ❌ **NÃO oferece links de reprodução diretos**

---

## 🏗️ Arquitetura da Plataforma

### Stack Técnico
- **Frontend:** Next.js (React)
- **Rendering:** Server-Side Rendered (SSR)
- **Estilo:** CSS Modules / Tailwind
- **Asset Format:** .svg, .woff2 (fontes Geist)

### Endpoints Principais
```
GET / - Homepage
GET /takvim - Calendar (calendar of episodes)
GET /reels - Shorts/Clips
GET /akis - Feed
GET /ne-izlesem - What should I watch
GET /esles - Match/Pairing
GET /imdb-top-100 - IMDb Top 100
GET /home-extra - Extra content
GET /turkce-dublaj-dizi-izle - Turkish dubbed series
GET /yerli-dizi-izle - Turkish series
GET /yabanci-dizi-izle - Foreign series
GET /anime-izle - Anime
GET /kdrama-izle - Korean drama
GET /asya-dizileri-izle - Asian series
GET /{slug}/{sezon} - Season page
GET /{slug}-{sezon}-{bolum} - Episode page
```

---

## 📺 Categorias de Conteúdo

### 1. **Türkçe Dublaj Diziler** (Turkish Dubbed Series)
- Séries estrangeiras com dublagem profissional em turco
- Exemplos: Lupin (2021, 7.5★), When Calls the Heart (2014, 7.9★)
- Full HD (1080p+)
- Dublagem de estúdio turco profissional

### 2. **Yerli Diziler** (Turkish/Domestic Series)
- Séries produzidas na Turquia
- Classificáveis por gênero (Drama, Comédia, Crime, etc)

### 3. **Yabancı Diziler** (Foreign Series)
- Séries internacionais sem dublagem turca
- Pode ter legendas em turco

### 4. **Anime İzle** (Anime)
- Anime com legendas em turco
- Rastreamento de episódios semanais

### 5. **Kore Dizileri** (K-Dramas)
- Séries coreanas com dublagem/legendas em turco

### 6. **Asya Dizileri** (Asian Series)
- Conteúdo asiático geral

---

## 🎬 Metadados Disponíveis

### Informações de Série
```json
{
  "title": "The Lord of the Rings: The Rings of Power",
  "imdb_rating": 6.8,
  "year": 2022,
  "genres": ["Fantastik", "Dram"],
  "platform": "Prime Video",
  "description": "Amazon Studios'un dizisi...",
  "total_seasons": 3,
  "status": "ongoing"
}
```

### Informações de Episódio
```json
{
  "season": 3,
  "episode": 7,
  "air_date": "25 Kasım 2026",
  "duration_minutes": 60,
  "title": "7. Bölüm",
  "dub_status": "Dublaj",
  "subtitle_status": "Altyazı",
  "url": "/the-lord-of-the-rings-the-rings-of-power-3-sezon-7-bolum"
}
```

---

## 🎯 Badges & Flags Informativos

Dizilla marca episódios com:
- **YENİ DİZİ** - Nova série
- **TRENDDE** - Em tendência
- **YENİ SEZON** - Nova temporada
- **Dublaj** - Tem dublagem turca
- **Altyazı** - Tem legenda turca
- **ŞU AN** - Episódio atualmente assistindo (user tracking)

---

## 🔄 Fluxo de Usuário Típico

1. Usuário navega para categoria (ex: Türkçe Dublaj Diziler)
2. Vê lista de séries com metadados
3. Clica em série de interesse
4. Vê página de série com:
   - Descrição
   - Lista de temporadas
   - Lista de episódios com badges de dub/subtitle
5. Clica em episódio específico
6. **PROBLEMA:** Vê mensagem "Telif nedeniyle bu içerik kaldırılmıştır" (Content removed due to copyright)

---

## ⚠️ Observação Crítica: Ausência de Players

**STATUS ATUAL:** Dizilla **removeu ou bloqueou todos os players embedados** na plataforma.

Evidências:
- Episódios mostram mensagem de copyright
- Nenhuma requisição XHR para buscar dados de player
- Nenhum iframe ou embed de streaming
- Sem API calls para sources/embeds

**Hipótese:** Dizilla anteriormente tinha players embedados (como Vidly, VidSrc, etc) mas os removeu por questões legais de copyright.

---

## 💡 Potencial de Integração com LOVELL

### ✅ O que Dizilla PODE oferecer a LOVELL

1. **Data Source para Descoberta**
   - API de metadados de séries
   - Validação de quais série têm dublagem turca
   - Rastreamento de episódios recentes

2. **Categorização de Conteúdo**
   - Identificar séries "Türkçe Dublaj"
   - Validar disponibilidade de legenda
   - Marcar conteúdo anime

3. **Calendário de Episódios**
   - Novo episódio?
   - Data de air?
   - Duração?

### ❌ O que Dizilla NÃO pode oferecer

- **Nenhum stream direto**
- **Nenhum player funcional**
- **Nenhum link para reprodução**
- **Nenhuma fonte de vídeo**

---

## 🔗 Fluxo de Integração Proposto

Se Dizilla tiver uma API ou se conseguirmos fazer scraping:

```
1. Consultar Dizilla → Metadados de série
2. Verificar: Tem "Türkçe Dublaj"?
3. SIM → Adicionar série ao catálogo LOVELL
4. Buscar sources reais em:
   - JetFilm
   - SelcukFlix
   - SinemaCX
   - HDFilmizle
   - AnimeciX (para anime)
5. Validar que sources têm TR dub/subtitle
6. Renderizar em LOVELL
```

---

## 🎨 UI/UX Observations

### Design Positivos
- **Categorização clara:** Series agrupadas por tipo (dub, origem, gênero)
- **Filtering inteligente:** Permite filtrar por IMDb score, genre, ano
- **Card layout:** Visual limpo com posters e informações
- **Season/Episode navigation:** Fácil navegar entre seasons e episódios
- **Badges informativos:** "Dublaj", "Altyazı", "ŞU AN", "YENİ"

### Funcionalidades úteis
- Seguir séries ("Takip et")
- Marcar como assistido ("İzledim")
- Calendário de lançamentos semanais
- Top 100 IMDb filtrado por turco
- Recomendações inteligentes por gênero

---

## 📊 Comparação com Outras Plataformas

| Plataforma | Tipo | Metadados | Players | Turkish Content |
|-----------|------|-----------|---------|-----------------|
| **Dizilla** | Discovery | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐⭐⭐⭐ |
| **JetFilm** | Streaming | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **SinemaCX** | Streaming | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **IMDb** | Discovery | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐ |
| **MyDramaList** | Discovery | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐⭐ |

---

## 🚀 Próximos Passos para Integração

### 1️⃣ **Investigação**
- [ ] Verificar se Dizilla tem API pública
- [ ] Se não, avaliar viabilidade de web scraping
- [ ] Mapear estrutura de URLs
- [ ] Identificar rate limits

### 2️⃣ **Implementação de Scraper** (se necessário)
```javascript
// Pseudo-código
async function fetchDizillaSeries() {
  const page = await fetch('https://dizilla.la/turkce-dublaj-dizi-izle');
  const html = await page.text();
  const series = parseSeriesFromHTML(html);
  
  for (const s of series) {
    if (s.hasTurkishDub) {
      const realSources = await findRealSources(s.title, s.year);
      // Adicionar ao LOVELL
    }
  }
}
```

### 3️⃣ **Fonte Complementar**
Usar Dizilla como:
- Validador: "Esta série tem Turkish dub?"
- Descoberta: "Que séries foram adicionadas esta semana?"
- Rastreamento: "Qual é o próximo episódio?"

---

## 🎓 Conclusão

**Dizilla é uma EXCELENTE fonte de descoberta de conteúdo em turco, mas NÃO é uma fonte de streaming.**

Para LOVELL:
- ✅ Integrar como **data source** para metadados
- ✅ Usar para **validar conteúdo turco**
- ✅ Aproveitar **categorização e filtering**
- ❌ NÃO depender para **players ou streams**

O valor real está em:
1. Descobrir QUAIS séries têm dublagem turca
2. Validar isso antes de buscar em provedores reais
3. Manter sincronização de metadados atualizada

---

**Recomendação Final:** Fazê-la integração **como fonte de metadados complementar**, não como streaming provider.
