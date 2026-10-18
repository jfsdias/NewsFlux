import { useContext } from "react"

import ReaderCommandsContext from "@/contexts/reader-commands-context"

const useReaderCommands = () => {
  const commands = useContext(ReaderCommandsContext)

  if (!commands) {
    throw new Error("useReaderCommands must be used within ReaderCommandsContext")
  }

  return commands
}

export default useReaderCommands
