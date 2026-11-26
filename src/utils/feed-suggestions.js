// Metadata selected from Plenary's awesome-rss-feeds at commit
// 9ab2482cae9031a5a39635c887fcfc8ece7e130a (CC0 1.0).
// The license applies to the source catalog, not publishers' feed contents.
// Language tags are NewsFlux editorial classifications, not upstream claims.
const catalog = [
  {
    title: "Folha de S.Paulo - Em cima da hora - Principal",
    url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml",
    topic: "brazil",
    language: "pt",
    source: "countries/with_category/Brazil.opml",
  },
  {
    title: "R7 - Notícias",
    url: "https://noticias.r7.com/feed.xml",
    topic: "brazil",
    language: "pt",
    source: "countries/with_category/Brazil.opml",
  },
  {
    title: "CNET",
    url: "https://www.cnet.com/rss/news/",
    topic: "tech",
    language: "en",
    source: "recommended/with_category/Tech.opml",
  },
  {
    title: "Hacker News",
    url: "https://news.ycombinator.com/rss",
    topic: "tech",
    language: "en",
    source: "recommended/with_category/Tech.opml",
  },
  {
    title: "Latest Science News -- ScienceDaily",
    url: "https://www.sciencedaily.com/rss/all.xml",
    topic: "science",
    language: "en",
    source: "recommended/with_category/Science.opml",
  },
  {
    title: "Nature",
    url: "https://www.nature.com/nature.rss",
    topic: "science",
    language: "en",
    source: "recommended/with_category/Science.opml",
  },
  {
    title: "Economic Times",
    url: "https://economictimes.indiatimes.com/rssfeedsdefault.cms",
    topic: "economy",
    language: "en",
    source: "recommended/with_category/Business & Economy.opml",
  },
  {
    title: "Fortune | FORTUNE",
    url: "https://fortune.com/feed",
    topic: "economy",
    language: "en",
    source: "recommended/with_category/Business & Economy.opml",
  },
  {
    title: "Jornal de Brasília",
    url: "https://jornaldebrasilia.com.br/feed/",
    topic: "brazil",
    language: "pt",
    source: "countries/with_category/Brazil.opml",
  },
  {
    title: "The Rio Times",
    url: "https://riotimesonline.com/feed/",
    topic: "brazil",
    language: "en",
    source: "countries/with_category/Brazil.opml",
  },
  {
    title: "Engadget - Technology News & Expert Reviews",
    url: "https://www.engadget.com/rss.xml",
    topic: "tech",
    language: "en",
    source: "recommended/with_category/Tech.opml",
  },
  {
    title: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    topic: "tech",
    language: "en",
    source: "recommended/with_category/Tech.opml",
  },
  {
    title: "Phys.org - latest science and technology news stories",
    url: "https://phys.org/rss-feed/",
    topic: "science",
    language: "en",
    source: "recommended/with_category/Science.opml",
  },
  {
    title: "Popular Science",
    url: "https://www.popsci.com/arcio/rss/",
    topic: "science",
    language: "en",
    source: "recommended/with_category/Science.opml",
  },
  {
    title: "Forbes - Business",
    url: "https://www.forbes.com/business/feed/",
    topic: "economy",
    language: "en",
    source: "recommended/with_category/Business & Economy.opml",
  },
  {
    title: "Yahoo Finance",
    url: "https://finance.yahoo.com/news/rssindex",
    topic: "economy",
    language: "en",
    source: "recommended/with_category/Business & Economy.opml",
  },
]

export const normalizeFeedUrl = (value) => {
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol)) {
      return ""
    }
    url.hash = ""
    const path = url.pathname.replace(/\/+$/, "")
    return `${url.host.toLowerCase()}${path}${url.search}`
  } catch {
    return ""
  }
}

export const getFeedSuggestions = (topic, language, subscribedFeeds) => {
  if (!topic || !language) {
    return []
  }
  const subscribed = new Set(subscribedFeeds.map(({ feed_url }) => normalizeFeedUrl(feed_url)))
  return catalog.filter(
    (item) =>
      item.topic === topic &&
      (language === "any" || item.language === language) &&
      !subscribed.has(normalizeFeedUrl(item.url)),
  )
}
