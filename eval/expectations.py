#!/usr/bin/env python3
"""Independent Decimal checks for scenario expectations; never imports the app calculator."""
from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

CENT = Decimal("0.01")
ROOT = Path(__file__).resolve().parents[1]
REFERENCES = {
    "joinery-reference.json": (("26854.30", "2175.20", "29029.50"), [120_000, 480_000, 190_000, 70_000, 189_900, 120_000, 333_380, 33_280, 63_200, 38_000, 18_000, 75_770, 24_000, 138_250, 38_000, 11_200, 23_710, 24_000, 37_130, 76_000, 12_800, 131_280, 48_000, 242_530, 15_000, 25_690, 37_130, 15_000, 22_580, 31_600]),
    "landscape-reference.json": (("15032.00", "1217.59", "16249.59"), [20_000, 528_000, 180_000, 54_000, 11_200, 33_000, 85_000, 255_000, 130_000, 43_200, 5_400, 9_400, 45_000, 104_000]),
    "civil-works-reference.json": (("9311.50", "754.23", "10065.73"), [80_000, 24_000, 108_300, 8_000, 49_600, 45_000, 117_000, 22_000, 78_000, 17_000, 114_000, 10_000, 56_500, 75_000, 27_500, 78_000, 21_250]),
}


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def check_reference(name: str, expected: tuple[tuple[str, str, str], list[int]]) -> None:
    expected_totals, expected_cents = expected
    fixture = json.loads((ROOT / "docs/examples/first-quotes" / name).read_text())
    amounts: list[Decimal] = []
    for section in fixture["sections"]:
        for position in section["lines"]:
            actual = Decimal(position["amount"]) if position["kind"] == "fixed" else money(Decimal(position["quantity"]) * Decimal(position["unitPrice"]))
            assert actual == Decimal(position["amount"]), (name, position["number"], actual, position["amount"])
            amounts.append(actual)
    assert [int(value * 100) for value in amounts] == expected_cents, name
    subtotal = sum(amounts, Decimal("0"))
    vat = money(subtotal * Decimal("0.081"))
    total = subtotal + vat
    assert (subtotal, vat, total) == tuple(map(Decimal, expected_totals)), (name, subtotal, vat, total)


def check_synthetic_and_adapted_arithmetic() -> None:
    # Source-derived edits with Artisan-supplied adaptations.
    assert money(Decimal("43.750") * Decimal("79.00")) == Decimal("3456.25")
    assert money(Decimal("12.500") * Decimal("40.00")) == Decimal("500.00")
    assert money(Decimal("4.700") * Decimal("79.00")) == Decimal("371.30")
    assert money(Decimal("40.000") * Decimal("79.00")) == Decimal("3160.00")
    assert money(Decimal("18.000") * Decimal("3.00")) == Decimal("54.00")
    source_subtotal = Decimal("3333.80") + Decimal("240.00")
    source_discount = money(source_subtotal * Decimal("0.10"))
    source_net = source_subtotal - source_discount
    assert (source_subtotal, source_discount, money(source_net * Decimal("0.081")), source_net + money(source_net * Decimal("0.081"))) == (
        Decimal("3573.80"), Decimal("357.38"), Decimal("260.53"), Decimal("3476.95"),
    )
    assert money(Decimal("42.200") * Decimal("71.10")) == Decimal("3000.42")
    assert money(Decimal("8.000") * Decimal("71.10")) == Decimal("568.80")
    # Explicitly synthetic arithmetic controls, not source commercial facts.
    synthetic_line = money(Decimal("0.125") * Decimal("80.20"))
    assert synthetic_line == Decimal("10.03")
    assert synthetic_line + money(synthetic_line * Decimal("0.081")) == Decimal("10.84")
    assert money(Decimal("4.25") * Decimal("2.80") * Decimal("79.00")) == Decimal("940.10")


if __name__ == "__main__":
    for filename, expected in REFERENCES.items():
        check_reference(filename, expected)
    check_synthetic_and_adapted_arithmetic()
    print("Decimal expectations verified")
