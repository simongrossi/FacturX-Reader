"use strict";

/* Même borne que les contrôles Rust : 18 chiffres entiers et huit décimales. */
const DECIMAL_SCALE = 100000000n;
const DECIMAL_CENT = 1000000n;
const decimalGroups = new Intl.NumberFormat("fr-FR");

function decimalUnits(value) {
  const match = /^([+-]?)(\d+)(?:[.,](\d{1,8}))?$/.exec(String(value ?? "").trim());
  if (!match || match[2].length > 18) return null;
  const units = BigInt(match[2]) * DECIMAL_SCALE + BigInt((match[3] || "").padEnd(8, "0"));
  return match[1] === "-" ? -units : units;
}

function decimalCompare(left, right) {
  const a = decimalUnits(left), b = decimalUnits(right);
  return a == null || b == null ? null : a < b ? -1 : a > b ? 1 : 0;
}

function decimalRoundDiv(numerator, divisor) {
  if (divisor < 0n) return decimalRoundDiv(-numerator, -divisor);
  return numerator < 0n ? -((-numerator + divisor / 2n) / divisor) : (numerator + divisor / 2n) / divisor;
}

function decimalCents(value) {
  const units = decimalUnits(value);
  return units == null ? null : decimalRoundDiv(units, DECIMAL_CENT);
}

function decimalCentsText(cents) {
  const abs = cents < 0n ? -cents : cents;
  return (cents < 0n ? "-" : "") + (abs / 100n) + "." + String(abs % 100n).padStart(2, "0");
}

function decimalCentsFormat(cents) {
  const abs = cents < 0n ? -cents : cents;
  return (cents < 0n ? "−" : "") + decimalGroups.format(abs / 100n) + "," + String(abs % 100n).padStart(2, "0");
}

function decimalFormat(value) {
  const units = decimalUnits(value);
  if (units == null) return String(value ?? "");
  const abs = units < 0n ? -units : units;
  const fraction = String(abs % DECIMAL_SCALE).padStart(8, "0").replace(/0+$/, "").padEnd(2, "0");
  return (units < 0n ? "−" : "") + decimalGroups.format(abs / DECIMAL_SCALE) + "," + fraction;
}

function decimalChangePercent(current, previous) {
  const a = decimalUnits(current), b = decimalUnits(previous);
  if (a == null || b == null || b === 0n) return null;
  const tenths = decimalRoundDiv((a - b) * 1000n, b);
  if (tenths === 0n) return null;
  const abs = tenths < 0n ? -tenths : tenths;
  return (tenths > 0n ? "+" : "-") + (abs / 10n) + "," + (abs % 10n) + " %";
}
