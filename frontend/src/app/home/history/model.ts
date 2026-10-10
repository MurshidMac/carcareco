export interface IHistoryActivity {
    id: string;
    orderNr: number;
    name: 'offer' | 'repairjob';
    startedOn: string;
    startedBy: string | null;
    notes: string | null;
}

export interface IHistoryOffer {
    id: string;
    orderNr: number;
    number: string | null;
    issuedOn: string | null;
    sentOn: string | null;
    acceptedOn: string | null;
    totalWithVat: number;
}

export interface IHistoryInvoice {
    id: string;
    number: number | null;
    issuedOn: string | null;
    sentOn: string | null;
    paid: boolean;
    dueDays: number;
    totalWithVat: number;
}

export interface IHistoryWork {
    id: string;
    workNr: string;
    startedOn: string;
    completedOn: string | null;
    status: string;
    userStatus: string | null;
    notes: string | null;
    odo: number | null;
    regNr: string | null;
    vehicleId: string | null;
    clientId: string | null;
    clientName: string | null;
    mechanicNames: string | null;
    activities: IHistoryActivity[];
    offers: IHistoryOffer[];
    invoices: IHistoryInvoice[];
}

export interface IVehicleHistory {
    vehicle: {
        id: string;
        regNr: string;
        producer: string | null;
        model: string | null;
        vin: string | null;
        odo: number | null;
    };
    client: {
        id: string | null;
        name: string | null;
    };
    workOrders: IHistoryWork[];
}

export interface IClientVehicle {
    id: string;
    regNr: string;
    producer: string | null;
    model: string | null;
    vin: string | null;
}

export interface IClientHistory {
    client: {
        id: string;
        name: string | null;
        isPrivate: boolean;
        phone: string | null;
        email: string | null;
        regNr: string | null;
    };
    vehicles: IClientVehicle[];
    workOrders: IHistoryWork[];
}