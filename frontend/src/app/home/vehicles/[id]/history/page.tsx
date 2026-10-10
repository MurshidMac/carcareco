import { DescriptionItem } from "@/_components/DescriptionItem";
import { httpGet } from "@/_lib/server/query-api"
import Main from '../../../_components/Main';
import { CardHeader } from "@/_components/Card";
import HistoryLink from "@/_components/HistoryLink";
import HistoryTimeline from '../../../history/components/HistoryTimeline';
import { IVehicleHistory } from '../../../history/model';

export default async function Page({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const id = (await params).id;
    const data = await httpGet('vehicles/' + id + '/history');
    const history = await data.json() as IVehicleHistory;

    return (
        <Main header={
            <CardHeader title={"History of " + [history.vehicle.producer, history.vehicle.model].filter(Boolean).join(' ') + (history.vehicle.regNr ? ' ' + history.vehicle.regNr : '')}>
                <div className="flex items-center gap-x-2">
                    <a href={'/home/vehicles/' + id} className="inline-flex justify-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 shadow-xs ring-gray-300 ring-inset hover:bg-gray-50">Vehicle</a>
                    <HistoryLink id={id} pageName="vehicles"></HistoryLink>
                </div>
            </CardHeader>
        }>
            <div>
                {history.client.id && history.client.name &&
                    <dl className="divide-y divide-gray-100">
                        <DescriptionItem label='Current owner' value={history.client.name}></DescriptionItem>
                    </dl>
                }
                <HistoryTimeline workOrders={history.workOrders}></HistoryTimeline>
            </div>
        </Main>
    )
}