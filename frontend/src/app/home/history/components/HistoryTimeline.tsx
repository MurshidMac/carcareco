import moment from "moment";
import WorkStatusBadge from "../../work/_components/activity/badges/WorkStatusBadge";
import { IHistoryActivity, IHistoryInvoice, IHistoryOffer, IHistoryWork } from "../model";

const money = (v: number | null | undefined) =>
    v == null ? '' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(v);

const formatDate = (value: string | null | undefined) =>
    value ? moment(value).format('LL') : null;

function OfferItem({ offer }: { offer: IHistoryOffer }) {
    return (
        <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1">
            <span className="text-gray-700">
                Offer nr. {offer.number ?? offer.orderNr}
                {offer.acceptedOn && <span className="text-gray-500"> (accepted {formatDate(offer.acceptedOn)})</span>}
            </span>
            <span className="font-medium text-gray-900">{money(offer.totalWithVat)}</span>
        </li>
    )
}

function InvoiceItem({ invoice }: { invoice: IHistoryInvoice }) {
    return (
        <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1">
            <span className="text-gray-700">
                Invoice nr. {invoice.number}
                {invoice.issuedOn && <span className="text-gray-500"> ({formatDate(invoice.issuedOn)})</span>}
                {!invoice.paid && <span className="ml-1 text-xs font-medium text-red-600">unpaid</span>}
            </span>
            <span className="font-medium text-gray-900">{money(invoice.totalWithVat)}</span>
        </li>
    )
}

function ActivityItem({ activity }: { activity: IHistoryActivity }) {
    return (
        <li className="py-1">
            <span className="font-medium capitalize text-gray-900">{activity.name}</span>
            <span className="text-gray-500"> nr. {activity.orderNr}, started {formatDate(activity.startedOn)}</span>
            {activity.startedBy && <span className="text-gray-500"> by {activity.startedBy}</span>}
            {activity.notes && <p className="mt-0.5 text-sm text-gray-500">{activity.notes}</p>}
        </li>
    )
}

export default async function HistoryTimeline({ workOrders }: { workOrders: IHistoryWork[] }) {
    if (!workOrders || workOrders.length === 0) {
        return <p className="py-6 text-sm text-gray-500">No work orders found.</p>
    }

    return (
        <ul className="divide-y divide-gray-100">
            {workOrders.map((work) => (
                <li key={work.id} className="py-6">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <a href={'/home/work/' + work.id} className="text-sm/6 font-semibold text-indigo-600 hover:text-indigo-500">
                                Work nr. {work.workNr}
                            </a>
                            <WorkStatusBadge status={work.status} />
                        </div>
                        <span className="text-sm text-gray-500">
                            {formatDate(work.startedOn)}
                            {work.completedOn && <> – {formatDate(work.completedOn)}</>}
                        </span>
                    </div>

                    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        {work.clientId && work.clientName ? (
                            <div>
                                <dt className="text-gray-500">Client</dt>
                                <dd><a className="text-indigo-600 hover:text-indigo-500" href={'/home/clients/' + work.clientId}>{work.clientName}</a></dd>
                            </div>
                        ) : null}
                        {work.regNr && work.vehicleId ? (
                            <div>
                                <dt className="text-gray-500">Vehicle</dt>
                                <dd><a className="text-indigo-600 hover:text-indigo-500" href={'/home/vehicles/' + work.vehicleId}>{work.regNr}</a></dd>
                            </div>
                        ) : null}
                        {work.mechanicNames ? (
                            <div>
                                <dt className="text-gray-500">Mechanics</dt>
                                <dd className="text-gray-700">{work.mechanicNames}</dd>
                            </div>
                        ) : null}
                        {work.odo != null ? (
                            <div>
                                <dt className="text-gray-500">Odometer</dt>
                                <dd className="text-gray-700">{work.odo}</dd>
                            </div>
                        ) : null}
                    </dl>
                    {work.notes && <p className="mt-2 text-sm text-gray-500">{work.notes}</p>}

                    {work.offers.length > 0 && (
                        <div className="mt-3">
                            <h4 className="text-xs font-semibold tracking-wide text-gray-400 uppercase">Offers</h4>
                            <ul className="divide-y divide-gray-50">
                                {work.offers.map((offer) => <OfferItem key={offer.id} offer={offer} />)}
                            </ul>
                        </div>
                    )}

                    {work.invoices.length > 0 && (
                        <div className="mt-3">
                            <h4 className="text-xs font-semibold tracking-wide text-gray-400 uppercase">Invoice</h4>
                            <ul className="divide-y divide-gray-50">
                                {work.invoices.map((invoice) => <InvoiceItem key={invoice.id} invoice={invoice} />)}
                            </ul>
                        </div>
                    )}

                    {work.activities.length > 0 && (
                        <div className="mt-3">
                            <h4 className="text-xs font-semibold tracking-wide text-gray-400 uppercase">Activity</h4>
                            <ul className="divide-y divide-gray-50">
                                {work.activities.map((activity) => <ActivityItem key={activity.id} activity={activity} />)}
                            </ul>
                        </div>
                    )}
                </li>
            ))}
        </ul>
    )
}