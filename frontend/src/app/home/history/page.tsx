import Main from "../_components/Main";
import { CardHeader } from "@/_components/Card";
import HistorySearch from "./components/HistorySearch";

export default async function Page() {
    return (
        <Main header={
            <CardHeader title="History"
                description="Find the full maintenance history of a vehicle or a client — every work order with its offers, repairs and invoices.">
            </CardHeader>
        }>
            <HistorySearch></HistorySearch>
        </Main>
    )
}