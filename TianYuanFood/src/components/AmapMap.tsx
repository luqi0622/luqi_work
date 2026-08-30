/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    AMap: any;
  }
}

export default function AmapMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!mapContainer.current || window.AMap === undefined) return;

    const map = new window.AMap.Map(mapContainer.current, {
      zoom: 15,
      center: [119.60300276939806, 36.20463177424252],
    });

    mapRef.current = map;

    const marker = new window.AMap.Marker({
      position: [119.60300276939806, 36.20463177424252],
      title: '田原食品有限公司',
      map: map,
    });

    const infoWindow = new window.AMap.InfoWindow({
      content: '<div style="padding: 10px;">' +
        '<h3 style="margin-bottom: 5px; font-size: 16px; font-weight: bold;">田原食品有限公司</h3>' +
        '<p style="font-size: 14px; color: #666;">山东省潍坊市高密市柴沟镇土庄社区驻地</p>' +
        '</div>',
      offset: new window.AMap.Pixel(0, -30),
    });

    marker.on('click', function() {
      infoWindow.open(map, marker.getPosition());
    });

    infoWindow.open(map, marker.getPosition());

    return () => {
      map.destroy();
    };
  }, []);

  return (
    <div 
      ref={mapContainer} 
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  );
}