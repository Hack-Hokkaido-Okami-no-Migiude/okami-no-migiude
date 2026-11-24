// UI logic for the Japanese-first Shima tracer pages (pure helpers, runs with
// tsx): effort arithmetic and labels keep reported spent time and potential
// savings visibly separate, the exact-yen preview gate requires a full match,
// and yen/date render without locale reformatting.
import {
	canPreparePreview,
	effortMinutesPerWeek,
	formatPotentialPerMonth,
	formatSpentPerWeek,
	quantityBasisLabel,
	questStateLabel,
	yenDisplay,
} from '../../app/composables/shimaFormat';
import type { Quantity } from '../../shared/shima/schemas';
import assert from 'node:assert/strict';
import test from 'node:test';

const reported = (value: number, basis: string): Quantity => ({
	kind: 'owner-reported',
	value,
	basis,
	evidence: [
		{ sourceId: 'ans_x', sourceRev: 1, quote: 'quote' },
	],
});
const assumed = (value: number, basis: string): Quantity => ({
	kind: 'assumption',
	value,
	basis,
	evidence: [],
});

test('weekly spent time multiplies the two reported inputs or stays unknown', () => {
	const weekly = effortMinutesPerWeek(
		reported(10, '繁忙期は週あたり約10件（オーナー報告）。'),
		reported(15, '1件あたり約15分（オーナー報告）。'),
	);
	assert.equal(weekly, 150);
	assert.equal(
		effortMinutesPerWeek(
			{ kind: 'unknown', value: null, basis: null, evidence: [] },
			reported(15, 'basis'),
		),
		null,
	);
	assert.equal(
		effortMinutesPerWeek(reported(10, 'basis'), assumed(15, 'assumed basis')),
		150,
		'the arithmetic is the same whatever the evidentiary kind',
	);
});

test('labels keep reported, assumed, and unknown visibly apart', () => {
	assert.equal(quantityBasisLabel(reported(10, 'b')), '報告');
	assert.equal(quantityBasisLabel(assumed(15, 'b')), '仮定');
	assert.equal(
		quantityBasisLabel({ kind: 'unknown', value: null, basis: null, evidence: [] }),
		'不明',
	);
});

test('spent and potential render in their own periods with no conversion', () => {
	assert.equal(formatSpentPerWeek(150), '150分/週');
	assert.equal(formatSpentPerWeek(null), '不明');
	// A weekly spent figure is never silently re-expressed as a monthly one.
	assert.equal(formatSpentPerWeek(150).endsWith('/週'), true);
	assert.equal(formatPotentialPerMonth(10), '10時間/月');
	assert.equal(formatPotentialPerMonth(null), '不明');
	assert.equal(formatPotentialPerMonth(0), '0時間/月');
});

test('yen and dates render with exact digits', () => {
	assert.equal(yenDisplay(80000), '¥80000');
	assert.equal(yenDisplay(0), '¥0');
});

test('the preview gate requires both the exact yen and the exact date', () => {
	const catalog = { confirmedBudgetYen: 80000, targetDate: '2026-12-18' };
	assert.equal(
		canPreparePreview(
			{ proposedBudgetYen: 80000, targetDate: '2026-12-18' },
			catalog,
		),
		true,
	);
	assert.equal(
		canPreparePreview({ proposedBudgetYen: null, targetDate: '2026-12-18' }, catalog),
		false,
		'an unspecified cost is not silently substituted',
	);
	assert.equal(
		canPreparePreview({ proposedBudgetYen: 90000, targetDate: '2026-12-18' }, catalog),
		false,
	);
	assert.equal(
		canPreparePreview({ proposedBudgetYen: 80000, targetDate: null }, catalog),
		false,
	);
	assert.equal(
		canPreparePreview(
			{ proposedBudgetYen: 80000.5, targetDate: '2026-12-18' },
			catalog,
		),
		false,
	);
});

test('quest states read in Japanese', () => {
	assert.equal(questStateLabel('available'), '募集中');
	assert.equal(questStateLabel('claimed'), '申し込み済み');
});
