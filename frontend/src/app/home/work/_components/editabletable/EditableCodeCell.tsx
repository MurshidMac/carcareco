import React, { useState, useImperativeHandle } from "react";
import { EditableCellHandle, IEditableBaseCellProps  } from "./EditableCell";
import TypeAheadCombobox from "@/app/home/_components/TypeAheadCombobox";
import { dataPage } from "@/_lib/client/query-api"; 

 interface ISparePartData{
    code:string |null ,
    name:string   ,
    price:number| null
 }
interface IEditableCodeCellProps<Type extends   string | null> extends IEditableBaseCellProps<Type>
{
   nameRef: React.RefObject<EditableCellHandle<string>|null> ,
   priceRef: React.RefObject<EditableCellHandle<number>|null>,
   kindRef?: React.RefObject<EditableCellHandle<string>|null>
}

const EditableCodeCell = React.forwardRef<EditableCellHandle<string>,IEditableCodeCellProps<string|null>>((props, ref) => {
    const {
        defaultValue, placeholder, id, name, className, isEditing, nameRef, priceRef, kindRef
    } = props;

    const [internalValue, setInternalValue] = useState(defaultValue);
     
    const[selectedItem,setSelectedItem]=useState<ISparePartData | null >({ code:defaultValue,name:'',price:null});

    useImperativeHandle(ref, () => ({
        getValue(): string | null{
            return internalValue;
        },
        setValue(value: string| null) {
            return setInternalValue(value);
        },
    }));
 
    if (!isEditing) return internalValue;
 
    return (
        <TypeAheadCombobox
        id={id?.toString()}
        placeholder={placeholder}
        defaultValue={selectedItem}
        name={name}
        className={className}
        comboboxOptionsAbsolute={true}
        comboboxOptionsWidth={100}
        displayFormatter={(item)=>{ return  item?.code??''; }}
        optionFormatter={(item)=>{ return (item?.code??'')+ (item?.name?' ('+item.name+')':'') }}  
        onItemChange={(item)=>{
            setSelectedItem(item);
           if(item?.code) setInternalValue(item?.code);
           if(item?.code && kindRef?.current) kindRef.current.setValue('product');
           if(item?.name && nameRef?.current) nameRef?.current.setValue(item?.name);
           if(item?.price && priceRef?.current) priceRef?.current.setValue(item?.price)
        }}
        onSearch={(e,target)=>{

            const inputValue =e.currentTarget.value;
            if(!inputValue) return;
            dataPage({
                resourceName:'spareparts',
                searchText: inputValue ,
                whenReady:(items)=>{
                   const data =  items as ISparePartData[];
                    
                    data.unshift({
                        code:inputValue,
                        name:'',
                        price: null
                    });
                    target(data);

                },
                onFailure:({url,status,text})=>{
                    console.log(url);
                    console.log(status);
                    console.log(text);
                }
              })   
        }}
        > 
        </TypeAheadCombobox>
    )

});
EditableCodeCell.displayName = "EditableCodeCell";
export {
    EditableCodeCell
}
