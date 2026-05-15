import React, { useMemo } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;

type Marker = { lat: number; lng: number; color?: string; label?: string };
export type Polyline = {
  /** Encoded polyline string (Google polyline-algorithm). */
  encoded?: string;
  /** Or a raw list of points if no encoded string is available. */
  points?: Array<{ lat: number; lng: number }>;
  color?: string;
  /** True for a dashed/short stroke, used for the driver→pickup leg. */
  dashed?: boolean;
  /** Stroke weight in px, default 5. */
  weight?: number;
  /** If true, the polyline is drawn progressively from start to end, looping. */
  animated?: boolean;
};

type Props = {
  lat?: number | null;
  lng?: number | null;
  heading?: number | null;
  extraMarkers?: Marker[];
  polylines?: Polyline[];
  /** Auto-fit the map to include all markers + polylines. */
  fitBounds?: boolean;
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

function buildHtml(lat: number, lng: number, markers: Marker[], polylines: Polyline[], fitBounds: boolean) {
  const markersJson = JSON.stringify(markers || []);
  const polysJson = JSON.stringify(polylines || []);
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8" />
<meta name="viewport" content="initial-scale=1, maximum-scale=1" />
<style>html,body,#map{height:100%;margin:0;padding:0;background:#0A0A0A;}
#err{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:#A1A1AA;font:600 13px -apple-system,Inter,sans-serif;text-align:center;padding:20px;z-index:10;background:#0A0A0A}
#err.show{display:flex}
/* Hide Google branding, attribution bar, terms links and "View on Google Maps" overlay */
.gm-style-cc,
.gmnoprint a,
.gmnoprint span,
.gm-style a[href^="https://maps.google.com/maps"],
.gm-style a[href^="https://www.google.com/maps"],
.gm-style a[title="Signaler des erreurs cartographiques"],
.gm-style a[title="Report errors in the road map or imagery to Google"],
.gm-style-pbc,
.gm-iv-address,
img[alt="Google"],
a[aria-label*="Google"]{display:none !important;visibility:hidden !important;opacity:0 !important;pointer-events:none !important;}
/* Hide the bottom-left Google logo */
.gm-style > div > a > div > img{display:none !important;}
</style></head>
<body>
<div id="map"></div>
<div id="err">Chargement de la carte indisponible.<br/>Vérifiez votre connexion.</div>
<script>
let map, driverMarker, otherMarkers=[], otherPolys=[];
const FIT_BOUNDS = ${fitBounds ? 'true' : 'false'};
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
    drawPolylines(${polysJson});
    if (FIT_BOUNDS) fitToContent();
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
      if(!d.skipPan) map.panTo(pos);
      if(driverMarker) driverMarker.setPosition(pos);
    }
    if(d.type==='markers'){ drawMarkers(d.markers||[]); if (FIT_BOUNDS) fitToContent(); }
    if(d.type==='polylines'){ drawPolylines(d.polylines||[]); if (FIT_BOUNDS) fitToContent(); }
    if(d.type==='fit'){ fitToContent(); }
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
function drawPolylines(list){
  // Stop any in-flight animation and clear previous polys
  otherPolys.forEach(p=>{ try{ stopAnim(p); }catch(e){} p.setMap(null); });
  otherPolys=[];
  if (!google.maps.geometry || !google.maps.geometry.encoding) return;
  (list||[]).forEach(p=>{
    let path;
    if (p.encoded) {
      try { path = google.maps.geometry.encoding.decodePath(p.encoded); } catch(e){ path = null; }
    }
    if ((!path || !path.length) && Array.isArray(p.points)) {
      path = p.points.map(pt => new google.maps.LatLng(pt.lat, pt.lng));
    }
    if (!path || !path.length) return;

    if (p.animated && google.maps.geometry.spherical) {
      // Faint static "ghost" of the full route — keeps the original colour
      // visible behind the moving stroke so the user always sees the path.
      const ghost = new google.maps.Polyline({
        path: path, geodesic: true, map: map,
        strokeColor: p.color || '#22C55E',
        strokeOpacity: 0.25,
        strokeWeight: p.weight || 6,
      });
      otherPolys.push(ghost);

      // Animated bright polyline that progresses along the same path.
      const live = new google.maps.Polyline({
        path: [path[0]], geodesic: true, map: map,
        strokeColor: p.color || '#22C55E',
        strokeOpacity: 1,
        strokeWeight: (p.weight || 6) + 1,
      });
      live._fullPath = path;
      otherPolys.push(live);
      animatePolyline(live, path, 4500);
      return;
    }

    const opts = {
      path: path, geodesic: true, map: map,
      strokeColor: p.color || '#F5B72E',
      strokeOpacity: p.dashed ? 0 : 0.95,
      strokeWeight: p.weight || 5,
      icons: p.dashed ? [{
        icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeWeight: 3, scale: 3 },
        offset: '0', repeat: '14px'
      }] : undefined
    };
    const poly = new google.maps.Polyline(opts);
    otherPolys.push(poly);
  });
}

// Animates a polyline by progressively revealing its path from start to end,
// then pausing and looping. The animation length is in milliseconds.
function animatePolyline(poly, fullPath, durationMs){
  if (!fullPath || fullPath.length < 2) return;
  // Pre-compute segment lengths so the speed of progression matches the
  // actual road distance (smooth even on irregular point spacing).
  const segLens = [];
  let total = 0;
  for (let i=1; i<fullPath.length; i++){
    const d = google.maps.geometry.spherical.computeDistanceBetween(fullPath[i-1], fullPath[i]);
    segLens.push(d);
    total += d;
  }
  if (total <= 0) return;
  poly._animRunning = true;
  let startTs = null;
  function step(ts){
    if (!poly._animRunning) return;
    if (startTs === null) startTs = ts;
    const t = Math.min((ts - startTs) / durationMs, 1);
    const target = t * total;
    const pts = [fullPath[0]];
    let acc = 0;
    for (let i=0; i<segLens.length; i++){
      if (acc + segLens[i] <= target){
        pts.push(fullPath[i+1]);
        acc += segLens[i];
      } else {
        const remaining = target - acc;
        const frac = segLens[i] > 0 ? remaining / segLens[i] : 0;
        const interp = google.maps.geometry.spherical.interpolate(fullPath[i], fullPath[i+1], frac);
        pts.push(interp);
        break;
      }
    }
    try { poly.setPath(pts); } catch(e){}
    if (t < 1){
      poly._animFrame = requestAnimationFrame(step);
    } else {
      // Hold the completed trace briefly, then restart from A.
      poly._animTimeout = setTimeout(function(){
        if (!poly._animRunning) return;
        startTs = null;
        poly._animFrame = requestAnimationFrame(step);
      }, 900);
    }
  }
  poly._animFrame = requestAnimationFrame(step);
}

function stopAnim(poly){
  if (!poly) return;
  poly._animRunning = false;
  if (poly._animFrame) { try { cancelAnimationFrame(poly._animFrame); } catch(e){} }
  if (poly._animTimeout) { try { clearTimeout(poly._animTimeout); } catch(e){} }
}
function fitToContent(){
  if (!map) return;
  const b = new google.maps.LatLngBounds();
  let any = false;
  if (driverMarker && driverMarker.getPosition()) { b.extend(driverMarker.getPosition()); any = true; }
  otherMarkers.forEach(m => { if (m.getPosition()) { b.extend(m.getPosition()); any = true; }});
  otherPolys.forEach(p => {
    const path = p.getPath();
    if (!path) return;
    for (let i = 0; i < path.getLength(); i++) {
      b.extend(path.getAt(i));
      any = true;
    }
  });
  if (!any) return;
  // Add padding so pins/labels aren't clipped
  map.fitBounds(b, {top: 60, right: 40, bottom: 60, left: 40});
}
</script>
<script async defer src="https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=geometry&callback=initMap&v=weekly"></script>
</body></html>`;
}

export default function MapView({ lat, lng, extraMarkers = [], polylines = [], fitBounds = false, style }: Props) {
  const latitude = lat ?? 48.8566;
  const longitude = lng ?? 2.3522;
  // Build the HTML once at first render — subsequent updates flow through
  // postMessage so the map (and its zoom level) is preserved.
  const html = useMemo(
    () => buildHtml(latitude, longitude, extraMarkers, polylines, fitBounds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const webviewRef = React.useRef<WebView>(null);

  const post = React.useCallback((payload: any) => {
    const msg = JSON.stringify(payload);
    if (Platform.OS === 'web') {
      const iframe = document.querySelector('iframe[title="map"]') as HTMLIFrameElement | null;
      iframe?.contentWindow?.postMessage(msg, '*');
    } else {
      webviewRef.current?.postMessage(msg);
    }
  }, []);

  React.useEffect(() => {
    if (lat == null || lng == null) return;
    // When fitBounds is on, don't pan to the driver — we let fitBounds handle
    // the camera so the whole leg is visible.
    post({ type: 'center', lat, lng, skipPan: fitBounds });
  }, [lat, lng, fitBounds, post]);

  React.useEffect(() => {
    post({ type: 'markers', markers: extraMarkers });
  }, [extraMarkers, post]);

  React.useEffect(() => {
    post({ type: 'polylines', polylines });
  }, [polylines, post]);

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
