import {AppRegistry} from 'react-native';
import type {LayerAlphaOption} from '../../../src/layers/layer-blend-model.ts';
import {LayerBlendDemo} from '../../../examples/native-instruments/LayerBlendDemo.tsx';
// ?alpha=single renders a straight-only compositor; ?alpha=unavailable lists Premultiplied with a reason.
const catalogs:Record<string,readonly LayerAlphaOption[]>={
 single:[{id:'straight',label:'Straight alpha'}],
 unavailable:[{id:'straight',label:'Straight alpha'},{id:'premultiplied',label:'Premultiplied alpha',unavailableReason:'This compositor stores straight alpha only.'}],
};
const alphaModes=catalogs[new URLSearchParams(location.search).get('alpha')??'single'];
document.body.style.margin='0';AppRegistry.registerComponent('layer-blend-alpha',()=>()=><LayerBlendDemo {...(alphaModes?{alphaModes}:{})}/>);AppRegistry.runApplication('layer-blend-alpha',{rootTag:document.getElementById('root')});
