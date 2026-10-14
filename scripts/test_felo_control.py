import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('felo', Path(__file__).resolve().parents[1] / 'resources/hermes/felo-control.py')
felo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(felo)


class FeloControlTests(unittest.TestCase):
    def test_play_named_song_resolves_and_returns_verification_in_one_call(self):
        state = {'playbackState': 'playing', 'outputMuted': True, 'volumePercent': 0}
        with patch.object(felo, 'request', side_effect=[{'suggestedSongId': 'song123'}, {'ok': True, 'state': state}]) as request:
            result = felo.invoke_tool('felo_play', {'query': 'Stay', 'artist': 'The Kid LAROI'})
            self.assertEqual(result['state'], state)
            self.assertEqual(request.call_count, 2)  # search + command, no status round-trip
            self.assertEqual(request.call_args.args[2]['song_id'], 'song123')
            self.assertNotIn('volume_percent', request.call_args.args[2])

    def test_ambiguous_song_does_not_start_playback(self):
        candidates = [{'id': 'a', 'available': True}, {'id': 'b', 'available': True}]
        with patch.object(felo, 'request', return_value={'suggestedSongId': None, 'results': candidates, 'total': 2, 'hasMore': False}) as request:
            with self.assertRaises(felo.FeloError) as exc:
                felo.invoke_tool('felo_play', {'query': 'Stay'})
            self.assertEqual(exc.exception.data['error'], 'AMBIGUOUS_SONG')
            self.assertEqual(exc.exception.data['candidates'], candidates)
            self.assertEqual(request.call_count, 1)

    def test_invalid_arguments_cannot_issue_network_commands(self):
        invalid = [('felo_set_volume', {'percent': True}), ('felo_set_volume', {'percent': 101}),
                   ('felo_play', {'song_id': 'a', 'query': 'Stay'}), ('felo_play', {'artist': 'Artist'}),
                   ('felo_seek', {'seconds': float('nan')}), ('felo_seek', {'seconds': -1}),
                   ('felo_enqueue', {}), ('felo_set_mode', {}), ('felo_pause', {'bogus': True}),
                   ('felo_play', {'query': '  '}), ('felo_pause', {'request_id': 'bad/id/123'})]
        with patch.object(felo, 'request') as request:
            for name, args in invalid:
                with self.subTest(name=name, args=args), self.assertRaises(felo.FeloError):
                    felo.invoke_tool(name, args)
            request.assert_not_called()

    def test_direct_pause_preserves_retry_id_without_status_lookup(self):
        with patch.object(felo, 'request', return_value={'ok': True, 'state': {'isPlaying': False}}) as request:
            felo.invoke_tool('felo_pause', {'request_id': 'retry-12345'})
            request.assert_called_once_with('/v1/player/pause', 'POST', {'requestId': 'retry-12345'})

    def test_unknown_protocol_is_negotiated_and_notifications_are_silent(self):
        response = felo.handle_message({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': 'future'}})
        self.assertIn(response['result']['protocolVersion'], felo.SUPPORTED_PROTOCOLS)
        self.assertIsNone(felo.handle_message({'jsonrpc': '2.0', 'method': 'notifications/initialized'}))

    def test_mcp_structured_errors_and_valid_json_after_malformed_input(self):
        lines = '{bad json}\n' + json.dumps({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'felo_set_volume', 'arguments': {'percent': 500}}}) + '\n'
        with patch('sys.stdin', io.StringIO(lines)), patch('sys.stdout', new_callable=io.StringIO) as output:
            felo.serve_mcp()
        replies = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(replies[0]['error']['code'], -32700)
        self.assertTrue(replies[1]['result']['isError'])
        self.assertEqual(replies[1]['result']['structuredContent']['error'], 'INVALID_ARGUMENTS')

    def test_play_playlist_and_collection_routes_properly(self):
        state = {'playbackState': 'playing', 'queueLength': 10}
        with patch.object(felo, 'request', return_value={'ok': True, 'state': state}) as request:
            result = felo.invoke_tool('felo_play_playlist', {'query': 'Chill Vibes', 'shuffle': True})
            self.assertEqual(result['state'], state)
            self.assertEqual(request.call_args.args[0], '/v1/player/play-playlist')
            self.assertEqual(request.call_args.args[2]['query'], 'Chill Vibes')
            self.assertTrue(request.call_args.args[2]['shuffle'])

        with patch.object(felo, 'request', return_value={'ok': True, 'state': state}) as request:
            result = felo.invoke_tool('felo_play_collection', {'collection': 'favorites'})
            self.assertEqual(result['state'], state)
            self.assertEqual(request.call_args.args[0], '/v1/player/play-collection')
            self.assertEqual(request.call_args.args[2]['collection'], 'favorites')


if __name__ == '__main__':
    unittest.main()
