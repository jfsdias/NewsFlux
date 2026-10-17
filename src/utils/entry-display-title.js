const getEntryDisplayTitle = (title, fallback) =>
  typeof title === "string" && title.trim().length > 0 ? title : fallback

export default getEntryDisplayTitle
