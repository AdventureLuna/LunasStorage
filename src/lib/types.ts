export type Location={id:string;name:string;parent_id:string|null;version:number};
export type Box={id:string;box_number:number;location_id:string;description:string|null;capacity_l:number|null;version:number};
export type Item={id:string;name:string;notes:string|null;tags:string[];quantity:number|null;quantity_unit:string|null;quantity_approximate:boolean;volume_l:number|null;location_id:string|null;box_id:string|null;archived:boolean;archived_at:string|null;version:number;created_at:string};
export type Photo={id:string;item_id:string;object_path:string;sort_order:number;is_cover:boolean;upload_status?:string};
export type InventoryRow=Item&{locations:Location|null;boxes:(Box&{locations:Location})|null;item_photos:Photo[]};
