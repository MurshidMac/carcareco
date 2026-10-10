import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/** `timestamp without time zone` */
type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** `timestamp with time zone` */
type TimestampTz = ColumnType<Date, Date | string, Date | string>;
/** nullable variant of the above */
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
/** `double precision` */
type Double = ColumnType<number, number | string, number | string>;
type NullableDouble = ColumnType<number | null, number | string | null, number | string | null>;
type NullableInt = ColumnType<number | null, number | null, number | null>;
type NullableString = ColumnType<string | null, string | null, string | null>;
/** `smallint` — `domain.employee` etc. surface these as numbers in the API. */
type SmallInt = ColumnType<number, number, number>;
type NullableSmallInt = ColumnType<number | null, number | null, number | null>;
type Bool = ColumnType<boolean, boolean, boolean>;
type NullableBool = ColumnType<boolean | null, boolean | null, boolean | null>;
type Uuid = ColumnType<string, string, string>;
type NullableUuid = ColumnType<string | null, string | null, string | null>;

export interface DomainTables {
  employee: {
    id: Uuid;
    firstname: string;
    lastname: string;
    email: NullableString;
    phone: NullableString;
    address: NullableString;
    proffession: NullableString;
    description: NullableString;
    introducedat: Timestamp;
  };

  vehicle: {
    id: Uuid;
    producer: NullableString;
    model: NullableString;
    regnr: string;
    vin: NullableString;
    odo: NullableInt;
    body: NullableString;
    drivingside: NullableString;
    engine: NullableString;
    productiondate: NullableTimestamp;
    region: NullableString;
    series: NullableString;
    transmission: NullableString;
    description: NullableString;
    introducedat: TimestampTz;
  };

  client: {
    id: Uuid;
    address: NullableString;
    country: NullableString;
    region: NullableString;
    city: NullableString;
    postalcode: NullableString;
    phone: NullableString;
    description: NullableString;
    isasshole: Bool;
    introducedat: TimestampTz;
  };

  vehicleregistration: {
    ownerid: Uuid;
    vehicleid: Uuid;
    datetimefrom: TimestampTz;
    datetimeto: NullableTimestamp;
  };

  clientemail: {
    address: string;
    clientid: Uuid | null;
    isactive: Bool;
  };

  privateclient: {
    id: Uuid;
    firstname: string;
    lastname: NullableString;
    personalcode: NullableString;
  };

  legalclient: {
    id: Uuid;
    name: string;
    regnr: NullableString;
  };

  pricing: {
    id: Uuid;
    senton: NullableTimestamp;
    printedon: NullableTimestamp;
    email: NullableString;
    partyname: string;
    partyaddress: NullableString;
    partycode: NullableString;
    vehicleline1: NullableString;
    vehicleline2: NullableString;
    vehicleline3: NullableString;
    vehicleline4: NullableString;
    issuedon: TimestampTz;
    issuerid: Uuid;
  };

  estimate: {
    id: Uuid;
    number: string;
  };

  invoice: {
    id: Uuid;
    number: number;
    paymenttype: SmallInt;
    duedays: SmallInt;
    ispaid: Bool;
    iscredited: NullableBool;
  };

  work: {
    id: Uuid;
    number: number;
    invoiceid: NullableUuid;
    clientid: NullableUuid;
    vehicleid: NullableUuid;
    startedon: TimestampTz;
    changedon: TimestampTz;
    starterid: Uuid;
    notes: NullableString;
    odo: NullableInt;
    userstatus: Generated<string>;
    completedon: NullableTimestamp;
    completerid: NullableUuid;
  };

  offer: {
    id: Uuid;
    workid: Uuid;
    ordernr: SmallInt;
    notes: NullableString;
    estimateid: NullableUuid;
    isvehilelinesonestimate: Bool;
    startedon: TimestampTz;
    starterid: Uuid;
    acceptedon: NullableTimestamp;
    acceptorid: NullableUuid;
  };

  repairjob: {
    id: Uuid;
    workid: Uuid;
    ordernr: SmallInt;
    notes: NullableString;
    startedon: TimestampTz;
    starterid: Uuid;
  };

  assignment: {
    workid: Uuid;
    mechanicid: Uuid;
  };

  saleable: {
    id: Uuid;
    name: string;
    quantity: Double;
    unit: string;
    price: Double;
    discount: NullableSmallInt;
  };

  serviceoffered: {
    id: Uuid;
    offerid: Uuid;
    jnr: SmallInt;
  };

  productoffered: {
    id: Uuid;
    offerid: Uuid;
    code: string;
    jnr: SmallInt;
    serviceid: NullableUuid;
  };

  serviceperformed: {
    id: Uuid;
    repairjobid: Uuid;
    notes: NullableString;
    mechanicid: NullableUuid;
    jnr: SmallInt;
  };

  productinstalled: {
    id: Uuid;
    repairjobid: Uuid;
    jnr: SmallInt;
    code: string;
    notes: NullableString;
    status: SmallInt;
    serviceid: NullableUuid;
  };

  storage: {
    id: Uuid;
    name: string;
    address: NullableString;
    description: NullableString;
    introducedat: TimestampTz;
  };

  unitedmotorsprice: {
    id: Uuid;
    price: Double;
    name: string;
    address: NullableString;
  };

  sparepart: {
    id: Uuid;
    code: string;
    name: string;
    price: NullableDouble;
    storageid: NullableUuid;
    quantity: NullableDouble;
    discount: NullableSmallInt;
    description: NullableString;
    introducedat: TimestampTz;
    umpriceid: NullableUuid;
  };

  pricingline: {
    pricingid: Uuid;
    nr: SmallInt;
    description: string;
    quantity: Double;
    unitprice: Double;
    unit: string;
    discount: SmallInt;
    total: Double;
    totalwithvat: Double;
  };
}

/** `public.user` lives outside the `domain` schema. */
export interface PublicTables {
  user: {
    username: string;
    password: string;
    tenantname: string;
    email: NullableString;
    validated: Bool;
    profile_image: Buffer | null;
    employeeid: NullableUuid;
  };
}

/**
 * `tenant_config.*` schema, written by the Options endpoints. Keys are
 * schema-qualified so Kysely emits `tenant_config.requisites`.
 */
export interface TenantConfigTables {
  'tenant_config.requisites': {
    id: Uuid;
    name: string;
    phone: NullableString;
    address: NullableString;
    email: NullableString;
    bank_account: NullableString;
    reg_nr: NullableString;
    tax_id: NullableString;
    created_at: Generated<TimestampTz>;
    updated_at: Generated<TimestampTz>;
  };
  'tenant_config.pricing': {
    id: Uuid;
    vat_rate: number;
    surcharge: NullableString;
    disclaimer: NullableString;
    signature_line: Bool;
    invoice_email_content: NullableString;
    estimate_email_content: NullableString;
    created_at: Generated<TimestampTz>;
    updated_at: Generated<TimestampTz>;
  };
}

export interface Database
  extends DomainTables,
    PublicTables,
    TenantConfigTables {}

export type Select<T> = Selectable<T>;
export type Insert<T> = Insertable<T>;
export type Update<T> = Updateable<T>;
