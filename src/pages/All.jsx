import { getAllEntries } from "@/apis"
import Content from "@/components/Content/Content"

const getEntries = (status, _starred, filterParams) => getAllEntries(status, filterParams)

const All = () => <Content getEntries={getEntries} info={{ from: "all", id: "" }} />

export default All
