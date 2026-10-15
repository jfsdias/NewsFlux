import { getTodayEntries } from "@/apis"
import Content from "@/components/Content/Content"

const getEntries = (status, _starred, filterParams) => getTodayEntries(status, filterParams)

const Today = () => <Content getEntries={getEntries} info={{ from: "today", id: "" }} />

export default Today
