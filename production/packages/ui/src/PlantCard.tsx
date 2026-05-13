import React from 'react';

export interface PlantCardProps {
  slug: string;
  name: string;
  latinName?: string;
  redListStatus?: string;
  imageUrl?: string;
  href: string;
}

export const PlantCard: React.FC<PlantCardProps> = ({ name, latinName, redListStatus, imageUrl, href }) => (
  <a href={href} className="card plant-card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
    {imageUrl && (
      <img src={imageUrl} alt={name} loading="lazy" style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 4 }} />
    )}
    <div style={{ marginTop: 8 }}>
      {redListStatus && <span style={{ fontSize: 11, color: '#5C6E5A' }}>{redListStatus}</span>}
      <h3 style={{ margin: '4px 0', fontSize: 18 }}>{name}</h3>
      {latinName && <em style={{ color: '#5C6E5A', fontSize: 13 }}>{latinName}</em>}
    </div>
  </a>
);
