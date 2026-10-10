import { httpGet } from '@/_lib/server/query-api'
import Main from './_components/Main';
import { CardHeader } from '@/_components/Card';
import WorkStatusBadge from './work/_components/activity/badges/WorkStatusBadge';
import moment from 'moment';

interface IDashboardRecentWork {
    id: string;
    workNr: string;
    startedOn: string;
    status: string;
    clientName: string | null;
    regNr: string | null;
    mechanicNames: string | null;
    notes: string | null;
    odo: number | null;
}

interface IDashboard {
    counts: {
        work: number;
        openWork: number;
        clients: number;
        vehicles: number;
        spareParts: number;
        storages: number;
    };
    recentWork: IDashboardRecentWork[];
}

const statCards: { key: keyof IDashboard['counts'], label: string, href: string }[] = [
    { key: 'work', label: 'Work orders', href: '/home/work' },
    { key: 'openWork', label: 'Open work', href: '/home/work' },
    { key: 'clients', label: 'Clients', href: '/home/clients' },
    { key: 'vehicles', label: 'Vehicles', href: '/home/vehicles' },
    { key: 'spareParts', label: 'Spare parts', href: '/home/inventory' },
    { key: 'storages', label: 'Storages', href: '/home/inventory' },
]

export default async function Page() {
    const response = await httpGet('dashboard');
    const dashboard = await response.json() as IDashboard;

    return (
        <Main header={<CardHeader title="Dashboard"
            description="A quick overview of the shop."></CardHeader>} narrow={false}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {statCards.map(card => (
                    <a key={card.key} href={card.href}
                        className="rounded-lg bg-white p-4 ring-1 shadow-xs ring-gray-200 hover:bg-gray-50">
                        <p className="text-2xl font-semibold text-gray-900">{dashboard.counts[card.key]}</p>
                        <p className="mt-1 text-sm/6 text-gray-500">{card.label}</p>
                    </a>
                ))}
            </div>

            <div className="mt-8">
                <h3 className="text-base font-semibold text-gray-900">Recent work</h3>
                {dashboard.recentWork.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">No work orders yet.</p>
                ) : (
                    <ul className="mt-3 divide-y divide-gray-100">
                        {dashboard.recentWork.map(work => (
                            <li key={work.id} className="py-4">
                                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                        <a href={'/home/work/' + work.id} className="text-sm/6 font-semibold text-indigo-600 hover:text-indigo-500">
                                            Work nr. {work.workNr}
                                        </a>
                                        <WorkStatusBadge status={work.status} />
                                    </div>
                                    <span className="text-sm text-gray-500">{moment(work.startedOn).format('LL')}</span>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700">
                                    {work.clientName && <span>{work.clientName}</span>}
                                    {work.regNr && <span>{work.regNr}</span>}
                                    {work.mechanicNames && <span className="text-gray-500">{work.mechanicNames}</span>}
                                </div>
                                {work.notes && <p className="mt-1 text-sm text-gray-500">{work.notes}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Main>
    )
}