'use server'

import { DescriptionItem } from '@/_components/DescriptionItem';
import { httpGet } from '@/_lib/server/query-api'
import Main from '../../_components/Main'; 
import DisplayOptionsMenu from '@/_components/DisplayOptionsMenu';
import HistoryLink from '@/_components/HistoryLink';
import { IVehicleData } from '../model';
import { CardHeader } from '@/_components/Card';



export default async function Page({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const id = (await params).id;
    const data = await httpGet('vehicles/' + id);
    const vehicle = await data.json() as IVehicleData;
  
    return (

        <Main header={
            <CardHeader  >
                 <h3 className="px-1 text-base font-semibold text-gray-900">Vehicle Information</h3>
                <div className="flex items-center gap-x-2">
                    <HistoryLink id={id} pageName='vehicles'></HistoryLink>
                    <DisplayOptionsMenu id={id} pageName='vehicles'></DisplayOptionsMenu>
                </div>
            </CardHeader>}>
            <dl className="divide-y divide-gray-100"> 
                <DescriptionItem label='Car make and model' value={[vehicle.producer, vehicle.model].join(' ')}></DescriptionItem>
                <DescriptionItem label='VIN' value={vehicle.vin}></DescriptionItem>
                <DescriptionItem label='Reg nr' value={vehicle.regNr}></DescriptionItem>
                <DescriptionItem label='Odometer' value={vehicle.odo}></DescriptionItem>
                <DescriptionItem label='Owner' value={vehicle.ownerName}></DescriptionItem>
                <DescriptionItem label='About' value={vehicle.description}></DescriptionItem>
            </dl>
        </Main>
    )

}