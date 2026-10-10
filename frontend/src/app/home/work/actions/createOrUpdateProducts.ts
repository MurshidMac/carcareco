'use server'

import { httpPut  } from "@/_lib/server/query-api";
import {  pushToast } from "@/_lib/server/pushToast";
import { redirect } from "next/navigation"; 
import { IProduct } from "../model";
import { NIL as NIL_UUID } from 'uuid';

export async function createOrUpdateProducts(formData: FormData) {
       
    const workId = formData.get('workId');
   
    const activityId = formData.get('activityId');
    const activityNumber= formData.get('activityNumber');
    const activityName = formData.get('activityName');
    const redirectUrl = `/home/work/${workId}/${activityId}` ;
    const apiUrl = `work/${activityName}/${activityId}/productsorservices`;
    
    const ids = formData.getAll('id');
    const codes = formData.getAll('part[code]');
    const names = formData.getAll('name');
    const prices = formData.getAll('price');
    const quantities = formData.getAll('quantity');
    const units = formData.getAll('unit');
    const discount = formData.getAll('discount');
    const kinds = formData.getAll('kind');
    const body = ids.map((id,index)=>{
        if(id.toString().startsWith('-')){
            //unsaved value
            id =NIL_UUID;
        }
        return {
            id:id,
            code:codes[index],
            name:names[index],
            price:+prices[index],
            quantity:+quantities[index],
            unit:units[index],
            discount:+discount[index],
            kind:kinds[index],
        } as IProduct
    })

     //isVehicelLinesOnPricing
    // const notes = formData.get('notes');
    //{id}/offer/{offerNumber}

    await httpPut({
        url:`work/${workId}/${activityName}/${activityNumber}`,
        body:{
            isVehicelLinesOnPricing:formData.get('isVehicelLinesOnPricing') == 'on',
            notes:formData.get('notes')
        }
    })

    const response =await httpPut({url:apiUrl,body});

    await response.text();
       
    pushToast(`Products and services updated successfully!`)

    redirect(redirectUrl)  
}
