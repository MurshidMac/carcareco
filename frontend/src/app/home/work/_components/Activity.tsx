'use client'

import ButtonGroup, { IButtonOption } from "@/_components/ButtonGroup"
import ApplyDiscountsDialog from "./activity/ApplyDiscountDialog"
import IssueOfferDialog from "./activity/IssueOfferDialog"
import ActivityNotes from "./activity/Notes"
import Saleables from "./editabletable/Saleables"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { BaseDialogHandle } from "@/_components/BaseDialog"
import { DataItemRowHandle } from "./editabletable/DataIItemRow"
import { IActivities, IOfferIssuance, IProduct, IWorkData } from "../model"
import OfferAcceptedDialog from "./activity/OfferAcceptedDialog" 
import SendPricingDialog from "./activity/SendPricingDialog"

export default function Activity({
    edit,
    work,
    activities,
    startfresh,
    issuance,
}: {
    edit: boolean,
    issuance?: IOfferIssuance,
    work: IWorkData,
    activities: IActivities,
    startfresh: boolean
}) {


    const [scrollDown,setScrollDown] = useState(false);

    useEffect(()=>{
        if(scrollDown){
            const scrollHeight = document.body.scrollHeight;
            window.scrollTo(0, scrollHeight);
            setScrollDown(false);
        }
    },[scrollDown])

    const applyDiscountsRef = React.useRef<BaseDialogHandle>(null);
    const issueOfferRef = React.useRef<BaseDialogHandle>(null);
    const offerAcceptedRef = React.useRef<BaseDialogHandle>(null);
     const sendOfferRef = React.useRef<BaseDialogHandle>(null);
    const [data, setData] = React.useState<IProduct[]>(activities.current.products);
    const tableRef = useRef<DataItemRowHandle<IProduct>[] | null[]>([]);
    const pathCancel = `/home/work/${work.id}/${activities.current.id}`
    const pathEdit = pathCancel + '/edit#items'
    const activityIsOffer = activities.items.find(x => x.id === activities.current.id)?.name == 'offer';
    const editOptions =work.issuance?[]: [
        { name: 'Add row', onClick: () =>{
            addEmptyRow(1);
            setScrollDown(true);
        } },
        { name: 'Cancel ', href: pathCancel },
        { name: 'Save', isPrimary: true },
        { name: 'Apply discount', inMenu: true, onClick: () => applyDiscountsRef.current?.open() },
        { name: 'Add more rows', inMenu: true, onClick: () =>{
            addEmptyRow(5);
            setScrollDown(true);
        } }
    ] as IButtonOption[]

    const issued = !!issuance?.issuedOn;

    const readOptions =work.issuance?[]: [
        { name: 'Edit ', isPrimary: true, inMenu:issued, href: pathEdit },

    
    ] as IButtonOption[]
    if (!work.issuance  && activityIsOffer) { //if work is not issued/completed we can do stuff with offer
       
        const accepted = !!issuance?.acceptedOn;
        const sent = !!issuance?.sentOn;
        readOptions[0].isPrimary = false; //if offer is issued, editing is not primary anymore
        if(data.length > 0) //if there is data something to issue
        { 
            readOptions.push({ 
                name:  (issued?'Reissue offer':'Issue offer'),
                 inMenu:issued,
                 isPrimary: !issued, //if not issued, issue is primary this is the next logical step
                 onClick: () => { issueOfferRef.current?.open() } 
                } as IButtonOption) 
        }
        if(issued){ //if issued, can send offer
            readOptions.push(
                {
                    name: (sent?'Resend offer':'Send offer'),
                    inMenu:sent,
                    isPrimary: false,
                    onClick:()=>{
                        sendOfferRef.current?.open()
                    }
                }
            );
        } 
        if(issued && !accepted){ //issued but but not accepted
            readOptions.push({ 
                name:  'Client accepted' ,
                 isPrimary: true, 
                 onClick: () => { offerAcceptedRef.current?.open()   } 
                } as IButtonOption)
        } 
    }
    const addEmptyRow = useCallback((count: number) => {
        for (let i = 1; i <= count; i++) {
            const negValue = data.filter(x=>x.id.startsWith('-')).map(o => +o.id);
            const nextId = (negValue.length>0 ? Math.min(...negValue) : 0)-1 
            data.push({ id: nextId.toString(), code: '', discount: null, name: '', price: null, quantity: 1, unit: 'tk', kind: 'service' })
        }
        setData([...data])
       
      }, [data]);

    
    const removeItem = (id: string) => {
        const elementToRemove = data.find(x => x.id == id);
        if (elementToRemove) {
            data.splice(data.indexOf(elementToRemove), 1);
            setData([...data]);
        }
    }
 
    useEffect(() => {
        //if empty state button was called add one row, todo
        if (startfresh && data.length == 0) {
            addEmptyRow(1);
        }
    }, [addEmptyRow, data.length,startfresh])
    return (
        <div className="">
            {activityIsOffer&&<OfferAcceptedDialog  dialogRef={offerAcceptedRef} work={work}  activities={activities}></OfferAcceptedDialog>}
            <ApplyDiscountsDialog dialogRef={applyDiscountsRef} tableRef={tableRef} ></ApplyDiscountsDialog>
            {activityIsOffer&& <IssueOfferDialog dialogRef={issueOfferRef} work={work}   activities={activities} ></IssueOfferDialog>}
            {activityIsOffer&&issuance&& <SendPricingDialog work={work} offerId={issuance.id}  dialogRef={sendOfferRef}></SendPricingDialog>}
            <div className="xl:flex xl:items-end">
                <div className="xl:flex-auto xl:px-4  ">
                    <ActivityNotes notes={activities.current.notes} edit={edit} ></ActivityNotes>
                </div>
            </div>
            <Saleables
                edit={edit} data={data} priceSummary={activities.current.priceSummary} tableRef={tableRef} removeItem={removeItem} refreshData={setData} >
            </Saleables>
            <div className="xl:flex inline-flex float-right xl:items-center">
                <div className="xl:flex-auto mt-8 inline-flex">

                </div>
                <div className="inline-flex   mt-8 mb-8 rounded-md shadow-xs">
                    {edit ? <ButtonGroup  options={editOptions} ></ButtonGroup> : <ButtonGroup options={readOptions} ></ButtonGroup>}
                </div>
            </div>
        </div>
    )
}