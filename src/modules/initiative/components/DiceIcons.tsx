// Solid-filled d20 icons for the 18×18 roll buttons. The outer polygon is
// filled with the button's accent color; the "20" label sits in contrasting
// black. Advantage/disadvantage get a small chevron overlay in the corner.

export function D20Icon() {
  return (
    <span className="d20-wrap">
      <svg viewBox="0 0 24 24" className="d20-svg" aria-hidden="true">
        <polygon
          points="12,2.5 21,7.5 21,16.5 12,21.5 3,16.5 3,7.5"
          fill="currentColor"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <polygon
          points="12,7 16.5,9.5 16.5,14.5 12,17 7.5,14.5 7.5,9.5"
          fill="rgba(0,0,0,0.25)"
        />
        <text
          x="12"
          y="14.2"
          textAnchor="middle"
          fontSize="6.8"
          fontWeight="800"
          fill="#1a1a2e"
        >
          20
        </text>
      </svg>
    </span>
  );
}

export function D20AdvIcon() {
  return (
    <span className="d20-wrap">
      <svg viewBox="0 0 24 24" className="d20-svg" aria-hidden="true">
        <polygon
          points="12,2.5 21,7.5 21,16.5 12,21.5 3,16.5 3,7.5"
          fill="currentColor"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <polygon
          points="12,7 16.5,9.5 16.5,14.5 12,17 7.5,14.5 7.5,9.5"
          fill="rgba(0,0,0,0.25)"
        />
        <text
          x="12"
          y="14.2"
          textAnchor="middle"
          fontSize="6.8"
          fontWeight="800"
          fill="#1a1a2e"
        >
          20
        </text>
      </svg>
      <svg viewBox="0 0 10 10" className="d20-overlay" aria-hidden="true">
        <path
          d="M5 1 L9.2 7 L0.8 7 Z"
          fill="#2ecc71"
          stroke="#0b2012"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function D20DisIcon() {
  return (
    <span className="d20-wrap">
      <svg viewBox="0 0 24 24" className="d20-svg" aria-hidden="true">
        <polygon
          points="12,2.5 21,7.5 21,16.5 12,21.5 3,16.5 3,7.5"
          fill="currentColor"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <polygon
          points="12,7 16.5,9.5 16.5,14.5 12,17 7.5,14.5 7.5,9.5"
          fill="rgba(0,0,0,0.25)"
        />
        <text
          x="12"
          y="14.2"
          textAnchor="middle"
          fontSize="6.8"
          fontWeight="800"
          fill="#1a1a2e"
        >
          20
        </text>
      </svg>
      <svg viewBox="0 0 10 10" className="d20-overlay" aria-hidden="true">
        <path
          d="M5 9 L9.2 3 L0.8 3 Z"
          fill="#e74c3c"
          stroke="#200808"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
