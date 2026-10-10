import React, { useState, useImperativeHandle } from "react";
import { EditableCellHandle, IEditableBaseCellProps } from "./EditableCell";

export interface IEditableSelectOption {
    value: string;
    label: string;
}

export interface IEditableSelectCellProps extends IEditableBaseCellProps<string> {
    options: IEditableSelectOption[];
}

const EditableSelectCell = React.forwardRef<EditableCellHandle<string>, IEditableSelectCellProps>((props, ref) => {
    const {
        defaultValue,
        id,
        name,
        className,
        isEditing,
        required,
        options,
    } = props;

    const [internalValue, setInternalValue] = useState<string | null>(defaultValue);

    useImperativeHandle(ref, () => ({
        getValue(): string | null {
            return internalValue;
        },
        setValue(value: string | null) {
            setInternalValue(value);
        },
    }));

    if (!isEditing) {
        return options.find((option) => option.value === internalValue)?.label ?? internalValue;
    }

    return (
        <select
            required={required}
            id={id?.toString()}
            name={name}
            className={className}
            value={internalValue ?? ''}
            onChange={(e) => setInternalValue(e.currentTarget.value)}
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );
});

EditableSelectCell.displayName = 'EditableSelectCell';
export {
    EditableSelectCell
}
