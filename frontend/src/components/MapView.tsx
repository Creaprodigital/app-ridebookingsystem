import React, { useMemo } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

type Marker = { lat: number; lng: number; color?: string; label?: string };
type Props = {
  lat?: number | null;
  lng?: number | null;
  heading?: number | null;
  extraMarkers?: Marker[];
  style?: any;
};

const darkStyle = JSON.stringify([
  { elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a0a0a' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#A1A1AA' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#27272a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#27272a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#71717A' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3f3f46' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050505' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#52525b' }] },
]);

function buildHtml(lat: number, lng: number, markers: Marker[]) {
  const markersJson = JSON.stringify(markers || []);
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="initial-scale=1, maximum-scale=1" />
<style>html,body,#map{height:100%;margin:0;padding:0;background:#0A0A0A;}
#err{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#A1A1AA;font:600 13px -apple-system,Inter,sans-serif;text-align:center;padding:20px;z-index:10;background:#0A0A0A}
#err.show{display:flex}
</style></head>
<body>
<div id="map"></div>
<div id="err">Chargement de la carte indisponible.<br/>Vérifiez votre connexion.</div>
<script>
let map, driverMarker, otherMarkers=[];
const DOT_ICON = {
  path: 0, // google.maps.SymbolPath.CIRCLE
  fillColor: '#F5B72E',
  fillOpacity: 1,
  strokeColor: '#0A0A0A',
  strokeWeight: 3,
  scale: 9
};
function pinIcon(color){
  return {
    path: 'M12 0C7 0 3 4 3 9c0 6 9 15 9 15s9-9 9-15c0-5-4-9-9-9z',
    fillColor: color || '#3B82F6',
    fillOpacity: 1,
    strokeColor: '#0A0A0A',
    strokeWeight: 2,
    scale: 1.4,
    anchor: {x:12,y:24}
  };
}
function initMap(){
  try {
    map = new google.maps.Map(document.getElementById('map'),{
      center:{lat:${lat},lng:${lng}}, zoom:15,
      disableDefaultUI:true, zoomControl:false, gestureHandling:'greedy',
      styles:${darkStyle}
    });
    driverMarker = new google.maps.Marker({
      position:{lat:${lat},lng:${lng}}, map, icon: DOT_ICON, title:'Vous'
    });
    drawMarkers(${markersJson});
    window.addEventListener('message', onMsg);
    document.addEventListener('message', onMsg);
  } catch(e){ showErr(); }
}
window.gm_authFailure = function(){ showErr(); };
function showErr(){ document.getElementById('err').classList.add('show'); }
function onMsg(ev){
  try{
    const d = JSON.parse(ev.data);
    if(d.type==='center' && map){
      const pos = {lat:d.lat,lng:d.lng};
      map.panTo(pos);
      if(driverMarker) driverMarker.setPosition(pos);
    }
    if(d.type==='markers'){ drawMarkers(d.markers||[]); }
  }catch(e){}
}
function drawMarkers(list){
  otherMarkers.forEach(m=>m.setMap(null)); otherMarkers=[];
  (list||[]).forEach(m=>{
    const mk = new google.maps.Marker({
      position:{lat:m.lat,lng:m.lng}, map,
      icon: pinIcon(m.color), label: m.label ? {text:m.label,color:'#fff',fontWeight:'800',fontSize:'11px'} : null
    });
    otherMarkers.push(mk);
  });
}
</script>
<script async defer src="https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&callback=initMap&v=weekly"></script>
</body></html>`;
}

export default function MapView({ lat, lng, extraMarkers = [], style }: Props) {
  const latitude = lat ?? 48.8566;
  const longitude = lng ?? 2.3522;
  const html = useMemo(() => buildHtml(latitude, longitude, extraMarkers), []);
  const webviewRef = React.useRef<WebView>(null);

  React.useEffect(() => {
    if (lat == null || lng == null) return;
    const msg = JSON.stringify({ type: 'center', lat, lng });
    if (Platform.OS === 'web') {
      const iframe = document.querySelector('iframe[title="map"]') as HTMLIFrameElement | null;
      iframe?.contentWindow?.postMessage(msg, '*');
    } else {
      webviewRef.current?.postMessage(msg);
    }
  }, [lat, lng]);

  React.useEffect(() => {
    const msg = JSON.stringify({ type: 'markers', markers: extraMarkers });
    if (Platform.OS === 'web') {
      const iframe = document.querySelector('iframe[title="map"]') as HTMLIFrameElement | null;
      iframe?.contentWindow?.postMessage(msg, '*');
    } else {
      webviewRef.current?.postMessage(msg);
    }
  }, [extraMarkers]);

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.box, style]} testID="map-view">
        {/* @ts-ignore */}
        <iframe
          srcDoc={html}
          style={{ border: 0, width: '100%', height: '100%', backgroundColor: '#0A0A0A' }}
          title="map"
        />
      </View>
    );
  }

  return (
    <View style={[styles.box, style]} testID="map-view">
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost' }}
        style={{ backgroundColor: '#0A0A0A' }}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: '#0A0A0A', overflow: 'hidden' },
});
