'use client'

import { useRouter } from 'next/navigation'
import { ClientsCombobox, VehiclesCombobox } from '../../_components/SearchCombobox'

export default function HistorySearch() {
    const router = useRouter()

    return (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
                <label className="block text-sm/6 font-medium text-gray-900">Vehicle history</label>
                <p className="mt-1 text-sm/6 text-gray-500">Search a vehicle to see all of its work orders, offers and invoices.</p>
                <VehiclesCombobox
                    name="vehicle"
                    onItemChange={(item) => { if (item?.value) router.push('/home/vehicles/' + item.value + '/history') }}
                ></VehiclesCombobox>
            </div>
            <div>
                <label className="block text-sm/6 font-medium text-gray-900">Client history</label>
                <p className="mt-1 text-sm/6 text-gray-500">Search a client to see all of their work orders and registered vehicles.</p>
                <ClientsCombobox
                    name="client"
                    onItemChange={(item) => { if (item?.value) router.push('/home/clients/' + item.value + '/history') }}
                ></ClientsCombobox>
            </div>
        </div>
    )
}