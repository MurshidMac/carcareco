import { httpGet } from "@/_lib/server/query-api"
import Main from '../../../_components/Main';
import { CardHeader } from "@/_components/Card";
import HistoryLink from "@/_components/HistoryLink";
import HistoryTimeline from '../../../history/components/HistoryTimeline';
import { IClientHistory } from '../../../history/model';

export default async function Page({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const id = (await params).id;
    const data = await httpGet('clients/' + id + '/history');
    const history = await data.json() as IClientHistory;

    return (
        <Main header={
            <CardHeader title={"History of " + (history.client.name ?? 'client')}>
                <div className="flex items-center gap-x-2">
                    <a href={'/home/clients/' + id} className="inline-flex justify-center gap-x-1.5 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 shadow-xs ring-gray-300 ring-inset hover:bg-gray-50">Client</a>
                    <HistoryLink id={id} pageName="clients"></HistoryLink>
                </div>
            </CardHeader>
        }>
            <div>
                {history.vehicles.length > 0 &&
                    <dl className="divide-y divide-gray-100">
                        <div className="px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
                            <dt className="text-sm/6 font-medium text-gray-900">Vehicles ({history.vehicles.length})</dt>
                            <dd className="mt-1 text-sm/6 text-gray-700 sm:col-span-2 sm:mt-0">
                                <ul className="space-y-1">
                                    {history.vehicles.map(vehicle => (
                                        <li key={vehicle.id}>
                                            <a className="text-indigo-600 hover:text-indigo-500" href={'/home/vehicles/' + vehicle.id}>
                                                {[vehicle.producer, vehicle.model].filter(Boolean).join(' ')}{vehicle.regNr ? ' ' + vehicle.regNr : ''}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </dd>
                        </div>
                    </dl>
                }
                <HistoryTimeline workOrders={history.workOrders}></HistoryTimeline>
            </div>
        </Main>
    )
}