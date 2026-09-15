import assert from 'node:assert/strict';
import {test} from 'node:test';
import {feedSchemaName, missingTables} from './upload';

test('schema name comes from the season, as a SQL identifier', () => {
  assert.equal(feedSchemaName('Summer 2026, 2026-08-19T21:11:39+00:00, version D'), 'summer_2026');
  assert.equal(feedSchemaName('Fall 2026, 2026-09-11T20:42:05+00:00, version D'), 'fall_2026');
  assert.equal(feedSchemaName('2026 Winter'), 'feed_2026_winter');
});

test('missingTables lists the required parquet files not selected', () => {
  assert.deepEqual(missingTables(['trips.parquet', 'stops.parquet']).slice(0, 2), ['agency', 'routes']);
  assert.equal(missingTables(['agency', 'routes', 'trips', 'stop_times', 'stops', 'calendar', 'calendar_dates', 'route_patterns', 'directions', 'feed_info', 'shape_lines'].map((t) => `${t}.parquet`)).length, 0);
});
