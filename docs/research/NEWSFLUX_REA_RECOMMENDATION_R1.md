# NEWSFLUX_REA_RECOMMENDATION_HANDOFF

> **ARCHIVE NOTICE — R1 — initial recommendation synthesis**
>
> - **STATUS:** SUPERSEDED
> - **SUPERSEDED_BY:** NEWSFLUX_REA_RECOMMENDATION_R2.md (falsification) and NEWSFLUX_REA_SOURCE_DISCOVERY_R3.md
> - **IMPLEMENTATION_AUTHORITY:** NO. This is research input, not a specification, roadmap decision or authorization to build.
> - **FINAL_RECOMMENDATION_ALGORITHM / FINAL_SOURCE_DISCOVERY_ALGORITHM / FINAL_RANKING_WEIGHTS:** NOT_APPROVED.
> - **Original file name:** `NEWSFLUX_REA_RECOMMENDATION_HANDOFF.md`. The body below is the report as received; its conclusions are not rewritten.
> - **Context:** R1 was written without access to the NewsFlux repository (the available checkout was a different product). The ARTICLE_SCORE_V1, SOURCE_SCORE_V1 and DISCOVERY_SCORE_V1 formulas, every numeric weight and every threshold in this document were rejected as unjustified parameters in R2 section 9. They must not be reused.
> - **Independent verification:** see [NEWSFLUX_INDEPENDENT_ENGINEERING_REVIEW.md](NEWSFLUX_INDEPENDENT_ENGINEERING_REVIEW.md). Later findings are recorded there, not here.
> - **Archive normalization:** Markdown formatting by the project Prettier; 0 local filesystem path(s) replaced with a placeholder; this notice added. Nothing else was changed.

**Data da pesquisa:** 20/10/2026. **Natureza:** pesquisa arquitetural, somente leitura. **Estado:** proposta para validação; nenhum código, PR, merge ou deploy no NewsFlux. O checkout disponível é `organizAI`, outro produto; as propostas de arquivos de PR são superfícies conceituais, não caminhos confirmados do NewsFlux.

## Método e limites da evidência

- `OBS` = código aberto examinado; `DOC` = documentação/blog oficial; `DESIGN` = proposta NewsFlux. Um travessão na matriz significa **não evidenciado nas fontes consultadas**, não ausência comprovada no produto.
- Foram examinados arquivos de código via conector GitHub e documentos oficiais via pesquisa web. O REA MCP conectado inspeciona artefatos e páginas, mas não oferece ferramenta de exploração de repositórios GitHub; a própria skill REA orienta ferramentas normais para repositórios com código-fonte. Não se executou software de terceiros nem se examinou binário proprietário. A cobertura de código é focal, não auditoria integral de todos os repositórios.
- Nenhum peso de ranking de terceiros é inferido. Os pesos V1 abaixo são **hipóteses explícitas de produto**, motivadas pelos componentes observados e sujeitas a teste offline e ajuste com feedback do proprietário. Não são métricas aprendidas nem números extraídos de produtos concorrentes.
- “Reeder” foi interpretado como **Reeder Classic**, o leitor RSS documentado pela fabricante; o produto Reeder mais novo tem posicionamento diferente. Esta escolha evita transferir funções entre produtos homônimos. Nenhuma implementação proprietária foi inferida.

### Cobertura das nove perguntas de pesquisa

| Pergunta           | Estado                         | Resposta sustentada / lacuna                                                                                                                              |
| ------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Curadoria       | Parcial                        | Regras explícitas NewsBlur, filtros Inoreader/FreshRSS e sinais disponíveis no Miniflux são observados; fórmulas internas dos fechados são desconhecidas. |
| 2. Descoberta      | Parcial                        | Diretórios/tópicos e similaridade de conteúdo são documentados; ranking proprietário de candidatos não foi publicado.                                     |
| 3. Clustering      | Respondida para padrões        | Código e documentação NewsBlur mostram duas camadas; Feedly/Inoreader documentam dedup. Não há algoritmo universal comprovado.                            |
| 4. Feedback        | Parcial                        | NewsBlur explicita escopos e precedência; estrelas/lido do Miniflux existem; efeito de cliques/dwell em concorrentes é desconhecido.                      |
| 5. Bolha           | Lacuna material                | MMR vem de pesquisa acadêmica; nenhum leitor examinado forneceu evidência de MMR, caps ou balanceamento de perspectivas.                                  |
| 6. Cold start      | Respondida para padrões        | Diretórios/bundles, escolha de tópico, URL e OPML são evidenciados; eficácia comparada ainda não foi medida.                                              |
| 7. Qualidade       | Parcial                        | Há foco temático e sinais técnicos; critérios confiáveis de originalidade e spam precisam ser validados em amostras reais.                                |
| 8. Explicabilidade | Parcial                        | Regras e prévias são visíveis; “por que este artigo?” detalhado não foi demonstrado para todos os produtos.                                               |
| 9. Self-hosted     | Respondida para viabilidade V1 | API e descoberta Miniflux + RSS-Bridge sustentam o caminho proposto; desempenho depende de volume/versão reais do NewsFlux.                               |

### Registro de evidências

| ID  | Evidência primária                                                                                                                                                                                                                                                                    | Achado                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | [NewsBlur `reader_utils.js`](https://github.com/samuelclay/NewsBlur/blob/main/media/js/newsblur/reader/reader_utils.js) e [post sobre escopos](https://blog.newsblur.com/2026/02/02/global-and-folder-scoped-intelligence-training/)                                                  | Regras explícitas por título, autor, tag, texto, URL e feed; escopo feed/pasta/global; super downvote prioritário.                                            |
| E2  | [NewsBlur `clustering/models.py`](https://github.com/samuelclay/NewsBlur/blob/main/apps/clustering/models.py) e [descrição oficial](https://blog.newsblur.com/2026/03/18/story-clustering/)                                                                                           | Título normalizado, sobreposição de palavras significativas, camada semântica e representante com alternativas visíveis.                                      |
| E3  | [NewsBlur Discover Sites](https://blog.newsblur.com/2025/02/02/discover-related-stories-and-sites/) e [cliente `discover_feeds.js`](https://github.com/samuelclay/NewsBlur/blob/main/media/js/newsblur/models/discover_feeds.js)                                                      | Similaridade por título/descrição do feed e títulos recentes, com prévia de artigos antes de seguir; autor afirma não usar coassinaturas pessoais no recurso. |
| E4  | [Feedly discovery](https://feedly.com/new-features/posts/new-ai-driven-discovery-experience), [seguir fontes](https://docs.feedly.com/article/768-follow-sources-in-feedly)                                                                                                           | Catálogo por tópicos, foco temático, volume, popularidade/engajamento, bundles e busca por URL. A fórmula interna não é pública.                              |
| E5  | [Feedly deduplicação](https://docs.feedly.com/article/218-how-does-deduplication-work)                                                                                                                                                                                                | Comparação de conteúdo e janela temporal; é uma descrição pública de produto, não código.                                                                     |
| E6  | [Inoreader Discovery](https://www.inoreader.com/blog/2015/02/inoreader-how-to-find-great-new-content.html), [coleções](https://www.inoreader.com/blog/2025/03/discover-quality-content-with-our-new-global-search-update.html), [filtros](https://www.inoreader.com/features/filters) | Diretórios, coleções editoriais, filtros com escopo e duplicados por URL/título/título aproximado.                                                            |
| E7  | [FreshRSS OPML](https://github.com/FreshRSS/FreshRSS/blob/edge/docs/en/developers/OPML.md), [filtragem](https://freshrss.github.io/FreshRSS/en/users/10_filter.html)                                                                                                                  | Prioridade explícita do feed, queries/filtros e critérios configuráveis de unicidade.                                                                         |
| E8  | [NetNewsWire `FeedFinder.swift`](https://github.com/Ranchero-Software/NetNewsWire/blob/main/Modules/FeedFinder/Sources/FeedFinder/FeedFinder.swift)                                                                                                                                   | Validação de feed direto, descoberta por `<head>`, candidatos HTML e caminhos conhecidos; confirma candidatos antes de adicioná-los.                          |
| E9  | [Miniflux `finder.go`](https://github.com/miniflux/v2/blob/main/internal/reader/subscription/finder.go), [API](https://miniflux.app/docs/api.html)                                                                                                                                    | Descoberta por URL, HTML, RSS-Bridge e caminhos conhecidos; API expõe feed/categoria/artigo, status, estrela, tempos e erros de parsing.                      |
| E10 | [Nextflux `articleRepository.js`](https://github.com/electh/nextflux/blob/main/src/db/repositories/articleRepository.js), [README](https://github.com/electh/nextflux)                                                                                                                | Cliente Miniflux: busca por título, filtro lido/favorito e ordenação temporal; nenhum algoritmo de recomendação observado no arquivo examinado.               |
| E11 | [ReadKit](https://readkit.app/), [Reeder Classic](https://www.reeder.app/classic/)                                                                                                                                                                                                    | Clientes com organização, smart folders (ReadKit) e leitura/sync (Reeder); detalhes de ranking proprietário não publicados nas fontes consultadas.            |
| E12 | [RSS-Bridge README](https://github.com/RSS-Bridge/rss-bridge/blob/master/README.md)                                                                                                                                                                                                   | Gera feeds para sites sem RSS; catálogo de bridges, cache e saídas Atom/JSON.                                                                                 |
| E13 | [Goldstein & Carbonell, MMR](https://aclanthology.org/X98-1025/)                                                                                                                                                                                                                      | Base acadêmica para reranking que equilibra relevância e redundância. Não há evidência de MMR implementado nos leitores estudados.                            |
| E14 | [NewsBlur licenciamento](https://github.com/samuelclay/NewsBlur/blob/main/LICENSE.md), [Miniflux](https://github.com/miniflux/v2), [NetNewsWire](https://github.com/Ranchero-Software/NetNewsWire), [FreshRSS](https://github.com/FreshRSS/FreshRSS)                                  | MIT, Apache-2.0, MIT e AGPL-3.0, respectivamente.                                                                                                             |

## DELIVERABLE 1 — NEWSFLUX_RECOMMENDATION_RESEARCH_MATRIX

Abreviações: OS = OPEN_SOURCE; PS = PARTIAL_SOURCE; CS = CLOSED_SOURCE; `—` = sem evidência no recorte consultado. Classificação refere-se ao código do produto principal, não a clientes de API publicados.

| APP            | SOURCE_AVAILABLE | CURATION                                  | SOURCE_DISCOVERY                             | TOPIC_MODEL                                              | STORY_CLUSTERING                                             | FEEDBACK                                        | DIVERSITY                                                    | COLD_START                     | EXPLAINABILITY                               | QUALITY_SCORING                                        | NOTABLE_IDEA                                 | REUSABLE_PATTERN                              | RISKS                                                                          |
| -------------- | ---------------- | ----------------------------------------- | -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------ | ------------------------------ | -------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Feedly         | CS               | AI Feeds, prioridades e mutes (DOC)       | Tópicos, URL, bundles (E4)                   | Taxonomia hierárquica (E4)                               | Duplicação por conteúdo (E5)                                 | Mutes/salvos (DOC)                              | Ordenações de descoberta por foco/popularidade/volume; MMR — | Bundles e tópicos (E4)         | Critérios de busca visíveis; score interno — | Foco, seguidores e engajamento anunciados; fórmula —   | Foco temático de fonte                       | Adaptar critérios visíveis, sem copiar modelo | Dependência de catálogo massivo e sinais coletivos                             |
| Inoreader      | CS               | Regras/filtros por conteúdo (E6)          | Diretório, coleções e busca global (E6)      | Categorias e tags sugeridas (DOC)                        | Duplicados URL/título/título próximo (E6)                    | Regras, estrelas e tags (E6)                    | Coleções editoriais; MMR —                                   | Diretório por categoria (E6)   | Regras inspecionáveis                        | Coleções curadas; fórmula —                            | Filtro explicável por escopo                 | Filtro antes do ranking                       | Filtros podem ocultar cobertura útil                                           |
| NewsBlur       | OS               | Classificadores explícitos e Focus (E1)   | Sites semelhantes com prévias (E3)           | Similaridade de conteúdo; classificador atributo (E1/E3) | Título + semântica, alternativas visíveis (E2)               | Likes/dislikes escopados (E1)                   | Alternativas por fonte; MMR —                                | Seguir feeds e descoberta (E3) | Regras e fonte do match                      | Estatísticas de feed, sem fórmula de qualidade pública | Treino de atributos + descoberta por amostra | Usar explicação e escopo                      | Complexidade operacional do stack NewsBlur                                     |
| Reeder Classic | CS               | Leitura/organização de feeds (E11)        | Adição de feeds; algoritmo de recomendação — | —                                                        | —                                                            | Estrela/estado via serviço, conforme integração | —                                                            | Adição manual                  | Fonte é explícita                            | —                                                      | Leitor sem ranking opaco                     | Preservar modo cronológico                    | Não atribuir algoritmo não publicado                                           |
| ReadKit        | CS               | Smart folders por consulta (E11)          | Gestão de feeds via provedores (E11)         | Consultas do usuário                                     | —                                                            | Tags/salvos via serviços                        | —                                                            | Feeds/provedores existentes    | Critério da smart folder                     | —                                                      | Visões salvas do usuário                     | Modo “consulta salva” paralelo ao feed        | Funcionalidade varia por provedor                                              |
| NetNewsWire    | OS               | RSS/leitura; ranking personalizado —      | `FeedFinder` validado (E8)                   | —                                                        | —                                                            | Lido/favorito; regra aprendida —                | —                                                            | URL inicial                    | Origem do feed é rastreável no finder        | —                                                      | Descoberta robusta por URL                   | Adaptação de fluxo, não de Swift              | Evitar fetch arbitrário/SSRF no servidor                                       |
| Nextflux       | OS               | Filtros e ordenação por data (E10)        | Gestão via Miniflux                          | Categorias Miniflux                                      | —                                                            | Status/estrela (E10)                            | —                                                            | OPML/feeds Miniflux (README)   | Ordenação visível                            | —                                                      | UX simples sobre Miniflux                    | Cliente desacoplado do backend                | Licença do repositório não identificada como licença padrão; não copiar código |
| FreshRSS       | OS               | Prioridade por feed, queries/filtros (E7) | Adição/OPML; catálogo temático —             | Categoria/tag/queries                                    | Unicidade configurável, não cluster de histórias evidenciado | Estrela/filtro explícito                        | —                                                            | OPML (E7)                      | Regras visíveis                              | —                                                      | Prioridade controlada pelo usuário           | Níveis de prioridade                          | AGPL se copiar código; não assumir isolamento de lógica                        |
| Miniflux       | OS               | Temporal, status, favorito e filtros (E9) | Descoberta de feed por URL (E9)              | Categoria/tag                                            | Dedup de entradas no backend, cluster de história —          | Lido/favorito (E9)                              | —                                                            | OPML, URL, categorias          | Fonte/status claros                          | Erro de parsing/checagem (E9)                          | Backend de dados confiável                   | Integrar API existente                        | Retenção limita histórico; API não fornece dwell confiável                     |

**Leitura da matriz:** não encontramos evidência de MMR, caps explícitos de fonte/tópico ou balanceamento de pontos de vista nesses nove produtos. A pesquisa foi focal; esta é uma lacuna de evidência, não prova de ausência. Também não tratamos “número de veículos que cobrem a história” como importância universal: pode refletir republicação da mesma agência.

## DELIVERABLE 2 — BEST IDEAS

| IDEA                               | ORIGIN                     | HOW_IT_WORKS                                               | EVIDENCE  | WHY_USEFUL_FOR_NEWSFLUX                          | ADAPTATION_REQUIRED                                 | COMPLEXITY | PRIVACY_COST | IMPLEMENTATION_COST |
| ---------------------------------- | -------------------------- | ---------------------------------------------------------- | --------- | ------------------------------------------------ | --------------------------------------------------- | ---------- | ------------ | ------------------- |
| Preferências explícitas com escopo | NewsBlur                   | Regras para atributo em feed/pasta/global; veto forte      | E1        | Usuário controla ruído sem treinamento invisível | Usar tópico/fonte e precedência previsível          | Baixa      | Baixo        | Baixo               |
| Prévia de fonte antes de seguir    | NewsBlur                   | Mostrar amostra recente e motivo de similaridade           | E3        | Reduz assinatura ruim                            | Candidatos locais/curados e Miniflux na confirmação | Média      | Baixo        | Médio               |
| Descobrir RSS real antes de bridge | Miniflux/NetNewsWire       | URL → feed direto/HTML → validar → fallback                | E8/E9     | Reaproveita infraestrutura disponível            | Usar endpoint Miniflux e política de SSRF           | Média      | Baixo        | Baixo               |
| Deduplicar sem apagar perspectivas | NewsBlur/Inoreader         | Agrupar artigos e expor fontes alternativas                | E2/E6     | Menos repetição, cobertura preservada            | Limites conservadores multilíngues                  | Média      | Baixo        | Médio               |
| Foco da fonte no tópico            | Feedly                     | Fonte avaliada por concentração temática, não só audiência | E4        | Favorece nichos úteis                            | Medir em amostra local, sem seguidores globais      | Média      | Baixo        | Médio               |
| Diversificação pós-ranking         | MMR acadêmico              | Seleção sequencial penaliza itens similares                | E13       | Evita topo dominado por um assunto/fonte         | Penalidade simples, caps transparentes              | Baixa      | Nenhum       | Baixo               |
| Consultas salvas e filtros claros  | ReadKit/FreshRSS/Inoreader | Seleções declaradas pelo usuário                           | E6/E7/E11 | Explicável e útil com pouco histórico            | Presets NewsFlux                                    | Baixa      | Baixo        | Baixo               |

## DELIVERABLE 3 — NEWSFLUX_RECOMMENDATION_ENGINE_V1

### Contrato e sinais

**Unidade:** recomendação de _história_ representada por um artigo principal com alternativas; usar artigo isolado quando não houver cluster confiável. **Universo:** entradas de feeds seguidos, tipicamente últimos 14 dias; janela ajustável. **Nunca** recomendar item de fonte/tópico silenciado, removido, sem URL segura, já lido quando a vista pede “não lidos”, ou candidato com duplicação exata de item já exibido. Não transformar “não clicou” nem marcação em lote como dislike. Favorito é sinal fraco positivo; regra explícita domina.

1. **INPUT SIGNALS:** Miniflux: feed, categoria, tags, título, URL, autor, conteúdo disponível, `published_at`, `created_at`, `status`, `starred`, `reading_time`, `checked_at`, `parsing_error_count`; OPML selecionado pelo usuário; feedback NewsFlux somente se opt-in. Não coletar dwell nem histórico do navegador.
2. **USER INTEREST PROFILE:** vetor esparso de tópicos da taxonomia escolhida, inicializado por tópicos/categorias/OPML. Atualização por favorito e ações explícitas com decaimento por idade e saturação por fonte; excluir eventos “marcar todos como lidos”. Permitir editar/exportar/apagar. Se sem histórico, vetor uniforme entre interesses escolhidos.
3. **ARTICLE TOPIC REPRESENTATION:** V1 determinístico: tokens normalizados de título, categorias, tags e texto curto; dicionário versionado por idioma, sinônimos declarados e n-gramas; vetor de tópicos normalizado para soma 1. Sem tema confiável = “desconhecido”, não “irrelevante”. Não forçar opinião política.
4. **CANDIDATE GENERATION:** buscar entradas recentes no Miniflux paginadas, limite explícito por feed; unir coleções “seguidos recentes”, “favoritos do mesmo tópico” e “exploração de tópicos adjacentes” de fontes já seguidas. Discovery externo gera propostas de _fonte_, jamais injeta artigo externo como assinatura. Uma fonte recém-seguida recebe amostragem controlada para escapar do zero histórico.
5. **ARTICLE SCORING:** fórmula abaixo, sem sinais indisponíveis inventados. Metadados ausentes recebem valor neutro e motivo não é exibido.
6. **SOURCE SCORING:** tópico/qualidade técnica/originalidade/cadência, com baixa confiança se amostra pequena. Não usar “credibilidade política” opaca.
7. **STORY CLUSTERING:** URL canônica e GUID exatos primeiro; depois título normalizado + janela temporal + entidades/termos, com limiar conservador; ver algoritmo abaixo. Mostrar todas as versões e nunca marcar alternativas como lidas automaticamente no V1.
8. **SOURCE DISCOVERY:** tópico → candidatos de catálogo local/OPML público escolhido/manual, links de fontes em artigos e consultas específicas aprovadas pelo usuário; validar via Miniflux e RSS-Bridge somente após URL concreta. Sem “rastrear a Web inteira”.
9. **NOVELTY:** assunto pouco representado nos últimos N itens _exibidos_, não uma preferência contra tópicos favoritos. Apenas resumo agregado efêmero da sessão. Tempo de meia vida do tema configurável.
10. **DIVERSITY:** reranking sequencial tipo MMR, caps por domínio/fonte/tópico e uma pequena cota de exploração. “Diversidade de pontos de vista” não é inferida de viés político; quando várias fontes reportam a mesma história, exibir alternativas, sem afirmar pluralidade ideológica.
11. **REPETITION PENALTY:** similaridade com histórias já mostradas na sessão e quantidade recente do mesmo tópico/fonte. Reiniciar em nova sessão; não punir repetição de alerta importante de modo irreversível.
12. **QUALITY:** integridade de feed, data válida, conteúdo útil, amostra sem títulos idênticos; detectar republicação sem punir automaticamente sindicância legítima. Fonte morta cai em viabilidade, não em reputação.
13. **EXPLICIT FEEDBACK:** “mais/menos deste tópico”, seguir/silenciar fonte e salvar. Regras exatas precedem score; deslikes brandos reduzem afinidade; mute remove. Mostrar escopo e oferecer desfazer.
14. **COLD START:** escolher até cinco tópicos e três feeds ou importar OPML; feed cronológico e amostra por tópico. Sem escolhas, só tendências de um catálogo editorial local opt-in, com seleção explicada; não presumir interesses.
15. **EXPLAINABILITY:** para cada cartão: até dois motivos positivos e um aviso de diversidade/duplicata; ex.: “Do seu feed X”, “Tópico Y escolhido por você”, “Outra cobertura: 3 fontes”. Motivos são derivados de contribuições computadas, nunca gerados por LLM.
16. **FAILURE MODES:** timestamp futuro/inválido → usar chegada para ordenação com aviso interno; feeds volumosos → cap de candidatos; artigo sem texto → título/tag com baixa confiança; idioma sem dicionário → fonte/cronologia; cluster falso → opção separar; RSS-Bridge instável → não recomendar seguir; Miniflux indisponível → estado explícito e nenhum candidato fabricado; feed com URL privada maliciosa → bloquear SSRF, redirects para IP privado e credenciais na URL.

### ARTICLE_SCORE_V1

Todos os termos `T, E, F, R, N, Q, I, P` estão em `[0,1]` e são testáveis. `clip(x)=min(1,max(0,x))`.

```text
base = 0.24*T + 0.20*E + 0.16*F + 0.12*R + 0.10*N + 0.10*Q + 0.08*I
ARTICLE_SCORE_V1 = round(100 * clip(base - 0.18*P))
```

- `T`: afinidade entre vetor de tópicos do usuário e do artigo (cosseno de vetores esparsos, clip). `E`: preferências explícitas positivas aplicáveis, com valor neutro 0.5 quando não há regra; dislikes explícitos fortes são veto anterior ao score. `F`: afinidade de fonte por seguimento/pasta/favoritos, suavizada com prior neutro 0.5 e tamanho de amostra. `R=exp(-ln(2)*idade_horas/48)` para notícia geral, com meia vida por categoria configurável. `N=1/(1+exposições_recentes_tópico)` normalizado para a sessão. `Q=SOURCE_SCORE/100`, limitado para fonte nova pela incerteza. `I`: termo de importância explícita: alerta/consulta salva do usuário ou história coberta por fontes originais distintas; padrão 0.5, sem popularidade externa. `P=max(similaridade_história_exibida, saturação_fonte_tópico)`.
- Pesos iniciais dão maior peso a intenção temática e preferência explícita (NewsBlur/Feedly), depois fonte, tempo e novidade. Foram escolhidos para soma positiva 1 e auditabilidade, **não medidos**. Validar com 30–50 comparações pareadas de “prefiro ler A ou B?”, cobertura por tópico/fonte e taxa de itens ocultos. Congelar versão dos pesos; qualquer alteração deve ser testada contra casos de regressão.
- Guardrails anteriores ao score: mute de fonte/tópico, duplicata exata, URL inválida, política de não lidos. Veto explícito não vira número fraco capaz de ser superado por recência. Se campo não disponível, redistribuir seus pesos proporcionais entre componentes disponíveis, preservando prioridade explícita e registrando versão/termos usados.

### SOURCE_SCORE_V1 e DISCOVERY_SCORE_V1

```text
SOURCE_SCORE_V1 = round(100 * (0.40*focus + 0.25*health + 0.20*originality + 0.15*cadence))
DISCOVERY_SCORE_V1 = round(100 * (0.60*SOURCE_SCORE_V1/100 + 0.25*coverage_gap + 0.15*preview_match))
```

`focus`: fração dos últimos até 20 artigos amostrados que satisfaz o tópico solicitado, com suavização Beta(2,2); `health`: fração de checagens/itens válidos em amostra recente, ou 0.5 quando não medida; `originality`: fração de itens sem URL/título/conteúdo quase idêntico ao de outras fontes, com valor neutro para sindicância não conclusiva; `cadence`: proximidade da frequência observada à faixa **escolhida pelo usuário**, sem premiar volume bruto. `coverage_gap`: quanto a fonte acrescenta tópicos/subtópicos ou idioma pouco cobertos; `preview_match`: fração de até cinco títulos/trechos que o usuário marcaria como pertinentes ou que casam com tópicos explícitos. Tudo limitado a `[0,1]`; mostrar `n` da amostra e faixa de confiança. Fonte com menos de cinco itens recebe score de 50 nos termos não medidos e selo “dados insuficientes”. Feed inválido não recebe score de descoberta.

### STORY_CLUSTERING_V1

1. Normalizar URL (remover parâmetros de tracking conhecidos, preservar parâmetros semânticos), resolver canonical somente de página segura; agrupar URL/GUID iguais.
2. No intervalo de 72 h, bloquear por idioma e entidades/nomes principais quando disponíveis; calcular palavras significativas dos títulos após remoção de stopwords por idioma. Ligação candidata se Jaccard ≥ 0.75 **e** interseção ≥ 3; para títulos curtos, exigir URL ou entidade exata. Esses números são limiares iniciais NewsFlux, não limiares retirados do NewsBlur.
3. Evitar encadeamento transitivo cego: todo membro precisa corresponder ao medoid/representante; limitar cluster a evento específico. Eleger representante por ARTICLE_SCORE, então maior conteúdo útil, com tie-break estável. Mesmo domínio pode ter atualização legítima: preservar como revisão e não colapsar automaticamente.
4. Exibir “mesma publicação” (URL/conteúdo quase idêntico) separado de “mesma história” (cobertura independente). Mostrar a razão do agrupamento e ação de separar. Medir falsos positivos em corpus multilíngue e de notícias recorrentes antes de ampliar limiares.

### Diversificação V1

Após score, escolher até 20 histórias sequencialmente maximizando `0.75*score_normalizado - 0.25*max_similaridade_com_já_selecionadas` (MMR proposto, E13), com no máximo 2 da mesma fonte e 4 do mesmo tópico no top 10, relaxando limites quando faltam candidatos. Reservar 1 vaga do top 10 para exploração de tópico adjacente **de fonte já seguida**, somente se base ≥ 0.45 e sem mute. Ponderações/caps são hipóteses NewsFlux a validar. Motivo de exploração visível. O usuário pode pedir “somente cronológico”, sem algoritmo.

## DELIVERABLE 4 — ALGORITHM TIERS

| Nível                          | Ganho esperado                                                                    | Custo/privacidade                                                                              | Quando não avançar                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 determinístico              | Controle, ranking auditável, dedup de títulos, descoberta por amostra             | CPU leve; dados locais                                                                         | É o padrão inicial.                                                                                                                                               |
| V2 embeddings locais opcionais | Recupera paráfrases e fontes semanticamente próximas; melhora cluster cross-title | Download de modelo, CPU/RAM e vetores derivados persistidos ou recalculados; manter tudo local | Não avançar se corpus pequeno, V1 já satisfatório, RAM escassa, ou falso positivo semântico não cair em avaliação pareada.                                        |
| V3 learning-to-rank opcional   | Ajusta pesos ao feedback real, possivelmente melhora ordem                        | Dados rotulados, avaliação temporal, deriva e explicação mais difíceis                         | Não avançar com poucos exemplos explícitos, ganho offline < margem definida (proposta: +5% NDCG@10 com intervalo de confiança), ou perda de controle/privacidade. |

Não exigir V2/V3 para corrigir bugs de V1. Embeddings não substituem filtros explícitos nem verificação de fonte. Nenhuma dependência de modelo proprietário em qualquer nível.

## DELIVERABLE 5 — SOURCE DISCOVERY ENGINE

```text
Interesses escolhidos/OPML/categorias Miniflux
→ expansão local de tópicos (sinônimos e um salto na taxonomia)
→ candidatos: catálogo curado versionado + URLs submetidas + links de fontes identificados
→ dedup por domínio/feed e excluir já seguidas/silenciadas
→ validação URL: http(s), DNS/redirect/SSRF, content type, tamanho/tempo
→ amostra de até 20 artigos e saúde do feed
→ SOURCE_SCORE e lacuna de cobertura
→ diversificar por domínio, tópico e idioma; mostrar prévia e motivo
→ detecção nativa Miniflux (`/v1/discover`), preferir RSS/Atom/JSON
→ fallback RSS-Bridge configurado, somente quando não houver feed nativo adequado
→ recomendação com estado “feed direto” ou “via bridge”, confiança e frequência
→ clique humano Follow
→ criação de assinatura no Miniflux; confirmação da resposta
```

O `finder.go` atual do Miniflux já consulta RSS-Bridge antes de caminhos conhecidos em certas condições; o NewsFlux deve usar o resultado da API e **verificar preferência por feed nativo** na sua própria decisão, sem duplicar a implementação interna ou presumir ordem fixa em futuras versões. RSS-Bridge é conversor de fontes sem RSS, não mecanismo de relevância. Limitar bridge allowlist, timeout, cache e termos da fonte; não enviar dados privados a instância pública. Não seguir fontes automaticamente.

## DELIVERABLE 6 — STORAGE / PRIVACY

- **V1 sem banco novo: sim, com escopo delimitado.** Pode calcular ranking sob demanda a partir da API Miniflux, tópicos escolhidos mantidos como configuração local controlada pelo usuário e catálogo curado versionado. Pode usar `starred` como sinal fraco, `status` para filtragem, `category/tags`, `published_at/created_at`, `feed_id`, `checked_at/parsing_error_count`. Não haverá “menos como isto”, mute global NewsFlux persistente nem histórico de exposição entre sessões nesse modo.
- **Persistir somente se o usuário ativar feedback próprio:** preferências explícitas (`topic/source`, ação, escopo, data), tópicos de onboarding, fontes candidatas rejeitadas com retenção curta, versão de taxonomia e pesos. Na etapa de clustering recorrente, persistir apenas identidade/representante de cluster e versão do algoritmo com TTL, ou recomputar para universo pequeno. Não duplicar conteúdo integral que já existe no Miniflux.
- **Calcular sob demanda:** score de artigo, justificativas, MMR, perfil agregado para janela curta, amostras de qualidade pequenas; cache em memória com expiração curta. Limitar busca histórica ao período necessário. Nunca registrar conteúdo de artigo, tokens de API, URLs com credenciais ou trilha completa de leitura em logs.
- **Miniflux não fornece:** intenção negativa, motivo de favorito, dwell confiável, exposições no NewsFlux e avaliação subjetiva de qualidade. Read status pode vir de marcação em lote; não inferir preferência negativa.
- **Privacidade:** processamento local; nenhum perfil exportado; apagar/exportar feedback; retenção configurável; dados de comportamento mínimos, sem fingerprint e sem inferência política. Sanitizar respostas Miniflux antes de enviá-las ao cliente, pois modelos de feed da API podem conter campos de configuração sensíveis.

## DELIVERABLE 7 — IMPLEMENTATION PLAN

Cada PR é isolado e começa com teste de comportamento que falha (RED), implementação (GREEN), refatoração e nova verificação. **Caminhos reais dependem de inspecionar o repositório NewsFlux**, ausente neste checkout. Não executar PRs nesta pesquisa.

| PR                             | GOAL                                                                 | DEPENDENCIES         | FILES/SURFACES LIKELY                            | TEST STRATEGY                                                      | RISK       | EXPECTED USER GAIN                       |
| ------------------------------ | -------------------------------------------------------------------- | -------------------- | ------------------------------------------------ | ------------------------------------------------------------------ | ---------- | ---------------------------------------- |
| NF-REC-01 contracts & fixtures | Contratos de candidato, score, motivo e adaptador read-only Miniflux | Nenhuma              | Adaptador API, domínio de recomendação, fixtures | RED para paginação, campos ausentes, ordem estável, token redigido | Baixo      | Base verificável                         |
| NF-REC-02 topic profile        | Taxonomia pequena, onboarding e OPML/categorias                      | 01                   | Perfil, configuração, UI onboarding              | RED para cold start, idioma, opt-out, importação                   | Médio      | Recomendações relevantes sem histórico   |
| NF-REC-03 article ranking      | ARTICLE_SCORE com pesos versionados e explicações                    | 01–02                | Funções puras, API read-only, UI feed            | RED para veto, pesos, recência, campos ausentes, desempate         | Médio      | “O que ler agora” útil                   |
| NF-REC-04 cluster & diversity  | Cluster conservador e reranking MMR/caps                             | 03                   | Agrupador, seletor, UI alternativas              | Corpus de contraexemplos, falsos clusters, fontes escassas         | Alto       | Menos repetição, mais cobertura          |
| NF-DISC-01 candidate sources   | Catálogo/URL e amostra local                                         | 01–02                | Descoberta, catálogo versionado, validação URL   | SSRF/redirect/timeout, dedup, amostra, fonte morta                 | Alto       | Novas fontes pertinentes                 |
| NF-DISC-02 score & preview     | SOURCE/DISCOVERY_SCORE, motivos e prévia                             | DISC-01, REC-02      | Scoring, UI Discover                             | Feed novo, sindicância, cadência, caps de domínio                  | Médio      | Decisão informada de seguir              |
| NF-DISC-03 follow integration  | Preferência RSS nativo, bridge opcional, Follow no Miniflux          | DISC-02              | Adaptador Miniflux, tela Follow                  | Idempotência, erro de bridge, nunca seguir sem clique              | Alto       | Fluxo completo descoberta→assinatura     |
| NF-FB-01 explicit feedback     | “Mais/menos”, mute, desfazer, armazenamento mínimo                   | REC-03               | Migração versionada se DB, API feedback, UI      | Precedência/veto, delete/export, retenção e isolamento usuário     | Alto       | Controle direto do feed                  |
| NF-SEM-01 optional local V2    | Embeddings locais e avaliação comparativa                            | 04 + corpus rotulado | Modelo local, index/cache opcional               | Medir precisão de clusters, memória/tempo, fallback V1             | Alto       | Melhor paráfrase se houver ganho real    |
| NF-LTR-01 optional V3          | Aprendizagem com opt-in e gate de métricas                           | Feedback suficiente  | Treino local/avaliação                           | Split temporal, regressão de diversidade, explicações              | Muito alto | Ordem mais pessoal apenas se demonstrado |

**Verificação por PR:** testes unitários de função pura, integração com Miniflux de teste/fake fiel à API, casos de segurança URL e UI de motivos; lint/typecheck/build do stack real. Após REC-03 e DISC-03, avaliação humana cega com conjunto de títulos e explicações; comparar com cronológico e V1 anterior. O primeiro PR deve manter chamadas read-only ao Miniflux.

## DELIVERABLE 8 — BUILD VS BORROW

| Decisão     | Componente                                                                                                                                                                                                  | Licença / razão                                                                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REUSE       | API e banco do Miniflux; RSS-Bridge já disponível                                                                                                                                                           | Miniflux Apache-2.0; RSS-Bridge declara código em domínio público/Unlicense, dependências próprias; integrar como serviços sem copiar código.                                                                                |
| ADAPT       | Fluxos de descoberta por URL do Miniflux/NetNewsWire; regras escopadas NewsBlur; dedup visível                                                                                                              | Ideias e interface própria; Miniflux Apache-2.0, NetNewsWire MIT, NewsBlur MIT. Se copiar trechos, manter avisos/licenças e revisar dependências.                                                                            |
| REIMPLEMENT | Ranking, perfil local, qualidade, MMR, cluster e explicações                                                                                                                                                | Algoritmo composto específico do NewsFlux, com testes e parâmetros próprios. MMR é conceito acadêmico, não código de concorrente.                                                                                            |
| AVOID       | Copiar código de Feedly/Inoreader/Reeder/ReadKit; copiar FreshRSS AGPL para núcleo sem revisão; copiar Nextflux sem licença clara; usar Elasticsearch/Redis/Celery/serviço cloud apenas porque NewsBlur usa | Produtos fechados não licenciam implementação; FreshRSS AGPL-3.0 exige análise de obrigações de distribuição/rede; README do Nextflux tem texto informal, sem licença padrão claramente identificada nas fontes consultadas. |

## Handoff compacto

```text
REPOS_REVIEWED=NewsBlur; Miniflux v2; FreshRSS; NetNewsWire; Nextflux; RSS-Bridge (integração)
OPEN_SOURCE_APPS=NewsBlur; NetNewsWire; Nextflux; FreshRSS; Miniflux
CLOSED_SOURCE_APPS=Feedly; Inoreader; Reeder Classic; ReadKit
KEY_DISCOVERIES=Preferência explícita escopada; descoberta por conteúdo da fonte e prévia; agrupamento preservando alternativas; API Miniflux suficiente para ranking inicial
BEST_CURATOR_IDEA=NewsBlur: atributos explícitos com veto e escopo
BEST_SOURCE_DISCOVERY_IDEA=NewsBlur prévia + Miniflux/NetNewsWire validação URL + Feedly foco temático
BEST_CLUSTERING_IDEA=NewsBlur: título + camada semântica com versões alternativas; V1 NewsFlux só heurística conservadora
BEST_FEEDBACK_IDEA=Regras explícitas e reversíveis; estrela Miniflux como sinal fraco
BEST_DIVERSITY_IDEA=MMR e caps transparentes propostos pelo NewsFlux, não atribuídos aos apps
NEWSFLUX_RECOMMENDATION_ENGINE_V1=Ranking determinístico local de histórias de fontes seguidas; descoberta separada de fontes, com Follow humano
ARTICLE_SCORE_V1=100*clip(.24T+.20E+.16F+.12R+.10N+.10Q+.08I-.18P)
SOURCE_SCORE_V1=100*(.40focus+.25health+.20originality+.15cadence)
DISCOVERY_SCORE_V1=100*(.60source+.25coverage_gap+.15preview_match)
STORY_CLUSTERING_V1=URL/GUID exatos; título/entidade/janela conservadores; representante + alternativas; sem auto-read
COLD_START_V1=Tópicos/OPML/feeds escolhidos e vista cronológica
EXPLAINABILITY_MODEL=Contribuições determinísticas; até dois motivos e um aviso; score e regra auditáveis
STORAGE_REQUIREMENTS=V1 mínimo sem DB; preferências negativas/mute persistentes requerem store próprio
NEW_DB_REQUIRED_V1=NO para V1 básico; YES para feedback NewsFlux durável e clusters cacheados persistentes, se ativados
PRIVACY_MODEL=Processamento local, sem dwell, sem coassinaturas, sem nuvem, retenção curta e opt-in para feedback
RSS_BRIDGE_ROLE=Fallback controlado para site sem feed nativo; nunca motor de ranking
MINIFLUX_ROLE=Fonte de feeds, artigos, estados e assinatura após Follow
IMPLEMENTATION_SEQUENCE=NF-REC-01→02→03→04; NF-DISC-01→02→03; NF-FB-01; V2/V3 só após gates
TOP_5_HIGH_GAIN_FEATURES=Ranking explicável; cold start por tópicos/OPML; cluster com alternativas; Discover com prévia; mute/menos como isto
RISKS=Cluster falso; ranking preso a fontes seguidas; feed spam; SSRF na descoberta; bridge frágil; histórico curto; score de qualidade confundir sindicância
OPEN_QUESTIONS=Repo NewsFlux/stack real? Versão Miniflux/RSS-Bridge? Número de feeds/idiomas? Catálogo inicial de fontes aprovado? Critério de sucesso UX? Retenção do histórico?
RECOMMENDED_FIRST_PR=NF-REC-01 (contratos, fixtures e adaptador Miniflux read-only)
CODE_CHANGES=NONE
MERGES=NONE
DEPLOYS=NONE
NEXT=Reconciliar com desenvolvimento noturno e red-team Claude; validar pesos/limiares em corpus do NewsFlux antes de implementar.
```
