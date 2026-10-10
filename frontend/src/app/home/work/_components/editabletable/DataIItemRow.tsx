import React  from "react";
import {   useImperativeHandle } from "react";
import { EditableCellHandle, EditableTextCell } from "./EditableCell";
import { EditableNumberCell } from "./EditableNumberCell";
import Link from "next/link";
import { XMarkIcon } from "@heroicons/react/16/solid"; 
import clsx from "clsx"; 
import { IProduct } from "../../model";
import { Bars3Icon } from "@heroicons/react/20/solid";
import { EditableCodeCell } from "./EditableCodeCell";
import { EditableSelectCell } from "./EditableSelectCell";

const KIND_OPTIONS = [
    { value: 'product', label: 'Product' },
    { value: 'service', label: 'Service' },
];

export type DataItemRowHandle<T> = {
    
    getValue: () => T; 
    applyDiscount(value: number): void
};

interface IRemoveItemHandle {
    (id:string): void
}

interface IOnDragHandle{
    (e:React.DragEvent<HTMLTableRowElement>):void
}
 

interface IDataItemRowProps {
    isEditing: boolean, 
    index: number, 
    item: IProduct, 
    onDragStart: IOnDragHandle, 
    onDragEnter: IOnDragHandle, 
     removeWorkItem: IRemoveItemHandle
};


//TODO maybe update only row when changing and on submit collect and submit
const DataItemRow = React.forwardRef<DataItemRowHandle<IProduct>, IDataItemRowProps>((props, ref) => {
 
    const { isEditing, index, item,  onDragStart,  onDragEnter,  removeWorkItem } = props; 
   
    const codeRef = React.useRef<EditableCellHandle<string>>(null);
    const kindRef = React.useRef<EditableCellHandle<string>>(null);
    const nameRef = React.useRef<EditableCellHandle<string>>(null);
    const priceRef = React.useRef<EditableCellHandle<number>>(null);
    const unitRef = React.useRef<EditableCellHandle<string>>(null);
    const quantityRef = React.useRef<EditableCellHandle<number>>(null);
    const discountRef = React.useRef<EditableCellHandle<number>>(null);

    useImperativeHandle(ref, () => ({
        
        getValue() {
            return {
                id: item?.id,
                code: codeRef.current?.getValue()??'',
                name: nameRef.current?.getValue()??'',
                price: priceRef.current?.getValue()??null,
                unit: unitRef.current?.getValue()??'',
                quantity: quantityRef.current?.getValue()??null,
                discount: discountRef.current?.getValue()??null,
                kind: (kindRef.current?.getValue() as 'product' | 'service' | null)??'product',
            };
        },
        applyDiscount(value: number) {
            discountRef.current?.setValue(value);
        }
    }));
 
    const textSize = clsx(  "font-medium  text-sm/7  px-2  outline-1 -outline-offset-1 outline-gray-300   focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600  " );
    const pricePropsClass = clsx(textSize, "text-right ");
    const codeStyle = clsx(textSize,   "w-full");
    const nameStyle = clsx( textSize, "w-full ");
    const tdStyle = isEditing ? "py-0 pr-3 pl-4 text-sm  whitespace-nowrap text-gray-500 sm:pl-0" : "px-2 py-2 text-sm whitespace-nowrap text-gray-900";
   
    return (
    <>
      <tr 
      key={ index.toString()} 
      id={item.id?.toString()} 
      draggable={isEditing}    
      onDragStart={onDragStart} 
      onDragEnter={onDragEnter}  
      >
        {isEditing && <>
            <td className="w-10 px-3 py-2"> 
            <input type="hidden" value={item.id} name="id"/>
            <button
                type="button"
                className=" bg-indigo-600 py-0 text-gray-700 bg-white shadow-xs hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-600"
            >
                <Bars3Icon aria-hidden="true" className="size-4" />
            </button>
        </td>
        </>}
       
        <td className={clsx("min-w-24 w-24",tdStyle)} >
            <EditableSelectCell
                id={item.id}
                name='kind'
                ref={kindRef}
                defaultValue={item.kind ?? 'product'}
                options={KIND_OPTIONS}
                className={clsx("w-full", codeStyle)}
                isEditing={isEditing}
                placeholder=""
            >
            </EditableSelectCell>
        </td>
        <td className={clsx("min-w-50 w-50",tdStyle)} >
          
            <EditableCodeCell //todo auto complete 
                placeholder="code ..."
                defaultValue={item.code}
                isEditing={isEditing}
                ref={codeRef}
                id={item.id}
                name='part'
                className={codeStyle}
                nameRef={nameRef}
                priceRef={priceRef}
                kindRef={kindRef}
            >
            </EditableCodeCell>
        </td>
        <td className={clsx("min-w-50",tdStyle)}  > 
                <EditableTextCell
                    id={item.id}
                    name='name'
                    className={nameStyle}
                    required={true}
                    ref={nameRef}
                    placeholder="(no value)"
                    defaultValue={item.name}
                    isEditing={isEditing}
                >
                </EditableTextCell> 
        </td>
        <td className={clsx("w-20 text-end",tdStyle)}  >
        <EditableNumberCell
                    id={item.id}
                    name='price'
                        placeholder=""
                        defaultValue={item.price}
                        isMoney={true}
                        required={true}
                         step="any"
                        className={clsx("w-20",pricePropsClass)}
                        ref={priceRef}
                        isEditing={isEditing}></EditableNumberCell>
        </td>
        <td className={clsx("w-15  text-end",tdStyle)}  >
        <EditableNumberCell   
                        placeholder=""
                        ref={quantityRef}
                        id={item.id}
                        name='quantity'
                        step="any"
                        defaultValue={item.quantity}
                        className={clsx("w-15",pricePropsClass)}
                        isEditing={isEditing}>
                    </EditableNumberCell> 
            </td>
            <td className={clsx("w-15  text-end",tdStyle)}  >
            <EditableTextCell  
                    id={item.id}
                    name='unit'
                        placeholder="(no value)"
                        ref={unitRef}
                        className={clsx("w-15",pricePropsClass)}
                        defaultValue={item.unit} isEditing={isEditing}></EditableTextCell>
            </td>
            <td className={clsx("w-15  text-end",tdStyle)}  >
                 <EditableNumberCell 
                    id={item.id}
                    name='discount'
                        defaultValue={item.discount}
                        step="5"
                        className={clsx("w-15",pricePropsClass)}
                        ref={discountRef}
                         placeholder="" isPercentage={true} isEditing={isEditing}>
                    </EditableNumberCell>
            </td>
      
        {isEditing && <td className="w-10 text-right text-end">
            <Link color="link" href="#" 
                onClick={(e) =>
                 {
                    e.preventDefault();
                    removeWorkItem(item.id)
                 }
                 }>
                <XMarkIcon className="h-6 w-6"></XMarkIcon>
            </Link>
        </td>}
    </tr>
    </>
  
    )
})

DataItemRow.displayName = 'DataItemRow'
export {
    DataItemRow
}