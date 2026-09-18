import React from 'react';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Rect,
  Path,
  Circle,
} from 'react-native-svg';

interface JeenMateLogoProps {
  size?: number;
}

export const JeenMateLogo: React.FC<JeenMateLogoProps> = ({ size = 76 }) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
      <Defs>
        <LinearGradient
          id="iconGradient"
          x1="96"
          y1="80"
          x2="420"
          y2="430"
          gradientUnits="userSpaceOnUse"
        >
          <Stop stopColor="#004D5A" />
          <Stop offset="1" stopColor="#0A6B7A" />
        </LinearGradient>

        <LinearGradient
          id="accentGradient"
          x1="160"
          y1="150"
          x2="360"
          y2="360"
          gradientUnits="userSpaceOnUse"
        >
          <Stop stopColor="#00A884" />
          <Stop offset="1" stopColor="#27EBA4" />
        </LinearGradient>
      </Defs>

      {/* Outer app shape */}
      <Rect
        x="42"
        y="42"
        width="428"
        height="428"
        rx="108"
        fill="#F4FAF8"
      />

      {/* Main icon */}
      <Rect
        x="70"
        y="70"
        width="372"
        height="372"
        rx="92"
        fill="url(#iconGradient)"
      />

      {/* Main chat bubble */}
      <Path
        d="M142 184 C142 148 171 120 207 120 H306 C342 120 371 148 371 184 V257 C371 293 342 321 306 321 H237 L188 367 C181 374 169 369 170 359 L174 321 H207 C171 321 142 293 142 257 V184Z"
        fill="#FFFFFF"
      />

      {/* Inner floating chat bubble */}
      <Path
        d="M184 205 C184 189 197 176 213 176 H303 C319 176 332 189 332 205 V244 C332 260 319 273 303 273 H262 L229 302 L232 273 H213 C197 273 184 260 184 244 V205Z"
        fill="#E6F4F6"
      />

      {/* Three conversation dots */}
      <Circle cx="218" cy="224" r="9" fill="#0A6B7A" />
      <Circle cx="258" cy="224" r="9" fill="#00A884" />
      <Circle cx="298" cy="224" r="9" fill="#0A6B7A" />

      {/* Connection / task accent */}
      <Path
        d="M177 350 C204 379 241 394 280 394 C319 394 350 379 373 354"
        stroke="url(#accentGradient)"
        strokeWidth="13"
        strokeLinecap="round"
      />

      {/* Check/connection symbol */}
      <Path
        d="M213 350 L232 369 L269 329"
        stroke="#FFFFFF"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Small connection node */}
      <Circle cx="365" cy="151" r="13" fill="#00A884" />
      <Circle cx="365" cy="151" r="6" fill="#FFFFFF" />
    </Svg>
  );
};
