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

function buildHtml(lat: number, lng: number, heading: number | null | undefined, markers: Marker[]) {
  const markersJson = JSON.stringify(markers || []);
  const h = heading ?? 0;
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="initial-scale=1, maximum-scale=1" />
<style>html,body,#map{height:100%;margin:0;padding:0;background:#0A0A0A;}
.driver-dot{position:relative;width:20px;height:20px;}
.driver-dot .pulse{position:absolute;inset:-10px;border-radius:9999px;background:rgba(245,183,46,.25);animation:pulse 2s infinite}
.driver-dot .core{position:absolute;inset:0;border-radius:9999px;background:#F5B72E;border:3px solid #0A0A0A;box-shadow:0 0 10px rgba(245,183,46,.8)}
@keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(2.2);opacity:0}}
</style></head>
<body>
<div id="map"></div>
<script>
let map, driverMarker, otherMarkers=[];
function initMap(){
  map = new google.maps.Map(document.getElementById('map'),{
    center:{lat:${lat},lng:${lng}}, zoom:15, disableDefaultUI:true, zoomControl:false,
    gestureHandling:'greedy', styles:${darkStyle}
  });
  const driverEl = document.createElement('div');
  driverEl.className='driver-dot';
  driverEl.innerHTML='<div class="pulse"></div><div class="core"></div>';
  driverMarker = new google.maps.marker.AdvancedMarkerElement({
    position:{lat:${lat},lng:${lng}}, map, content: driverEl, title:'Vous'
  });
  drawMarkers(${markersJson});
  window.addEventListener('message', onMsg);
  document.addEventListener('message', onMsg);
}
function onMsg(ev){
  try{
    const d = JSON.parse(ev.data);
    if(d.type==='center' && map){
      map.panTo({lat:d.lat,lng:d.lng});
      if(driverMarker) driverMarker.position={lat:d.lat,lng:d.lng};
    }
    if(d.type==='markers'){ drawMarkers(d.markers||[]); }
  }catch(e){}
}
function drawMarkers(list){
  otherMarkers.forEach(m=>m.map=null); otherMarkers=[];
  (list||[]).forEach(m=>{
    const el=document.createElement('div');
    el.style.cssText='background:'+(m.color||'#3B82F6')+';color:#fff;padding:6px 10px;border-radius:9999px;font:bold 12px Inter,sans-serif;border:2px solid #0A0A0A;box-shadow:0 2px 6px rgba(0,0,0,.5)';
    el.textContent = m.label || '•';
    const mk = new google.maps.marker.AdvancedMarkerElement({position:{lat:m.lat,lng:m.lng},map,content:el});
    otherMarkers.push(mk);
  });
}
</script>
<script async src="https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&callback=initMap&libraries=marker&loading=async&v=weekly&map_ids=DEMO_MAP_ID"></script>
</body></html>`;
}

export default function MapView({ lat, lng, heading, extraMarkers = [], style }: Props) {
  const latitude = lat ?? 48.8566;
  const longitude = lng ?? 2.3522;
  const html = useMemo(() => buildHtml(latitude, longitude, heading, extraMarkers), []);
  const webviewRef = React.useRef<WebView>(null);

  React.useEffect(() => {
    if (lat == null || lng == null) return;
    const msg = JSON.stringify({ type: 'center', lat, lng });
    if (Platform.OS === 'web') {
      const iframe = document.querySelector('iframe');
      iframe?.contentWindow?.postMessage(msg, '*');
    } else {
      webviewRef.current?.postMessage(msg);
    }
  }, [lat, lng]);

  React.useEffect(() => {
    const msg = JSON.stringify({ type: 'markers', markers: extraMarkers });
    if (Platform.OS === 'web') {
      const iframe = document.querySelector('iframe');
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
        source={{ html }}
        style={{ backgroundColor: '#0A0A0A' }}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: '#0A0A0A', overflow: 'hidden' },
});
