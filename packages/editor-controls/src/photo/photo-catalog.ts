import {validatePhotoRating,type PhotoRating} from './photo-adjustments.ts';
export interface PhotoCatalogItem {readonly id:string;readonly name:string;readonly thumbnailUri:string|null;readonly rating:PhotoRating}
export interface CatalogChoice {readonly id:string;readonly label:string}
export interface PhotoCatalogFilter {
 readonly query:string;readonly cameraId:string|null;readonly lensId:string|null;readonly albumId:string|null;
 readonly minimumStars:0|1|2|3|4|5;readonly flag:'all'|'none'|'pick'|'reject';
 readonly dateFrom:string|null;readonly dateTo:string|null;
 readonly iso:readonly [number,number]|null;readonly aperture:readonly [number,number]|null;readonly shutterSeconds:readonly [number,number]|null;
}
export function emptyPhotoCatalogFilter():PhotoCatalogFilter{return {query:'',cameraId:null,lensId:null,albumId:null,minimumStars:0,flag:'all',dateFrom:null,dateTo:null,iso:null,aperture:null,shutterSeconds:null};}
/** Calendar date without silently changing the source timezone. */
export function validPhotoDate(value:string):boolean {if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function validateCatalogFilter(value:PhotoCatalogFilter):void {
 if(typeof value.query!=='string'||value.query.length>256)throw new RangeError('Catalog query must be at most 256 characters');
 for(const key of ['cameraId','lensId','albumId'] as const)if(value[key]!==null&&(typeof value[key]!=='string'||!value[key]!.trim()||value[key]!.length>256))throw new TypeError('Invalid catalog filter identity');
 if(!Number.isInteger(value.minimumStars)||value.minimumStars<0||value.minimumStars>5||!['all','none','pick','reject'].includes(value.flag))throw new TypeError('Invalid rating filter');
 for(const key of ['dateFrom','dateTo'] as const)if(value[key]!==null&&!validPhotoDate(value[key]!))throw new RangeError('Catalog dates must be valid YYYY-MM-DD');
 if(value.dateFrom!==null&&value.dateTo!==null&&value.dateFrom>value.dateTo)throw new RangeError('Catalog date range is reversed');
 for(const [key,min,max] of [['iso',1,409600],['aperture',.1,128],['shutterSeconds',1/1000000,86400]] as const){const pair=value[key];if(pair!==null&&(!Array.isArray(pair)||pair.length!==2||!pair.every(n=>Number.isFinite(n)&&n>=min&&n<=max)||pair[0]>pair[1]))throw new RangeError(`Invalid ${key} range`);}
}
export function validateCatalogChoices(choices:readonly CatalogChoice[]):void {if(choices.length>2000)throw new RangeError('Too many catalog choices');const ids=new Set<string>();for(const choice of choices){if(typeof choice.id!=='string'||!choice.id.trim()||choice.id.length>256||typeof choice.label!=='string'||!choice.label.trim()||choice.label.length>256||ids.has(choice.id))throw new TypeError('Catalog choices require unique IDs and labels');ids.add(choice.id);}}
export function validatePhotoCatalog(photos:readonly PhotoCatalogItem[],selectedIds:readonly string[]):void {if(photos.length>100000||selectedIds.length>100000)throw new RangeError('Catalog page exceeds 100,000 photos');const ids=new Set<string>();for(const photo of photos){if(!photo.id.trim()||photo.id.length>256||!photo.name.trim()||photo.name.length>1024||ids.has(photo.id))throw new TypeError('Photo catalog requires unique IDs and names');if(photo.thumbnailUri!==null&&(!photo.thumbnailUri.trim()||photo.thumbnailUri.length>1048576))throw new RangeError('Invalid photo thumbnail');validatePhotoRating(photo.rating);ids.add(photo.id);}if(selectedIds.some(id=>typeof id!=='string'||!id.trim()||id.length>256)||new Set(selectedIds).size!==selectedIds.length)throw new TypeError('Duplicate selected photo');}
/** Selection may retain IDs outside a currently filtered/paged view. */
export function togglePhotoSelection(selected:readonly string[],id:string):readonly string[]{return selected.includes(id)?selected.filter(value=>value!==id):[...selected,id];}
