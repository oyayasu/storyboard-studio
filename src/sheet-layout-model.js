export function parseSheetLayout(input,builtInIds=[]){
 if(typeof input==='string'&&input.length>262144)throw Error('Layout files must be smaller than 256 KB.');
 let raw;try{raw=typeof input==='string'?JSON.parse(input):structuredClone(input);}catch{throw Error('Choose a readable storyboard sheet layout JSON file.');}
 if(raw?.format!=='storyboard-studio-sheet-layout'||raw.schemaVersion!==1)throw Error('This is not a supported storyboard sheet layout file.');
 if(typeof raw.id!=='string'||!/^custom-[a-zA-Z0-9_-]{1,70}$/.test(raw.id)||builtInIds.includes(raw.id))throw Error('A custom layout needs a unique ID beginning with custom-.');
 if(typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>100)throw Error('The layout needs a name of up to 100 characters.');
 const {width,height}=raw.page||{};
 if(![width,height].every(n=>Number.isFinite(n)&&n>=64&&n<=30000))throw Error('Invalid layout page dimensions.');
 if(!Array.isArray(raw.cards)||raw.cards.length<1||raw.cards.length>100)throw Error('A layout must have 1–100 card rectangles.');
 const inset=raw.cropInset??0;if(!Number.isFinite(inset)||inset<0||inset>30)throw Error('Invalid card inset.');
 const boxes=raw.cards.map(card=>{const a=[card.x,card.y,card.width,card.height];if(!a.every(Number.isFinite)||a[0]<0||a[1]<0||a[2]<=inset*2+4||a[3]<=inset*2+4||a[0]+a[2]>width||a[1]+a[3]>height)throw Error('A card rectangle falls outside the page, or is too small.');return a;});
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(Math.min(a[0]+a[2],b[0]+b[2])>Math.max(a[0],b[0])&&Math.min(a[1]+a[3],b[1]+b[3])>Math.max(a[1],b[1]))throw Error('Card rectangles must not overlap.');}
 return {format:raw.format,schemaVersion:1,id:raw.id,label:raw.name.trim(),name:raw.name.trim(),width,height,boxes,cropInset:inset,custom:true};
}
