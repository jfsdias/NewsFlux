const extractNodeText = (node) => {
  if (!node || typeof node !== "object") {
    return ""
  }

  if (node.type === "text" || typeof node.data === "string") {
    return node.data ?? ""
  }

  if (node.name === "br") {
    return "\n"
  }

  const children = node.children?.map((child) => extractNodeText(child)).join("") ?? ""
  if (node.name !== "p" || !children || children.endsWith("\n")) {
    return children
  }

  return `${children}\n`
}

const extractCodeContent = (element) => extractNodeText(element)

export default extractCodeContent
