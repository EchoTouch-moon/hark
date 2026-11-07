import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('launch-desktop-dev.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_existing_process_is_found(self):
        with patch.object(launcher.subprocess, 'run', return_value=Mock(stdout='123\n')):
            self.assertEqual(launcher.running_pid(), 123)

    def test_no_process_is_none(self):
        with patch.object(launcher.subprocess, 'run', return_value=Mock(stdout='')):
            self.assertIsNone(launcher.running_pid())

    def test_existing_app_is_not_spawned_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = root / 'hark-desktop'
            binary.touch()
            with patch.object(launcher, 'ROOT', root), patch.object(launcher, 'BINARY', binary), \
                 patch.object(launcher, 'server_ready', return_value=True), \
                 patch.object(launcher, 'running_pid', return_value=123), \
                 patch.object(launcher, 'activate') as activate, \
                 patch.object(launcher.subprocess, 'Popen') as spawn:
                launcher.launch()
                spawn.assert_not_called()
                activate.assert_called_once_with(123)

    def test_stopped_app_is_started_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            binary = root / 'hark-desktop'
            binary.touch()
            process = Mock(pid=456)
            process.poll.return_value = None
            with patch.object(launcher, 'ROOT', root), patch.object(launcher, 'BINARY', binary), \
                 patch.object(launcher, 'server_ready', return_value=True), \
                 patch.object(launcher, 'running_pid', return_value=None), \
                 patch.object(launcher, 'activate') as activate, \
                 patch.object(launcher.time, 'sleep'), \
                 patch.object(launcher.subprocess, 'Popen', return_value=process) as spawn:
                launcher.launch()
                spawn.assert_called_once()
                activate.assert_called_once_with(456)

    def test_missing_binary_is_actionable(self):
        with patch.object(launcher, 'BINARY', Path('/synthetic/missing/hark-desktop')):
            with self.assertRaisesRegex(RuntimeError, 'cargo build'):
                launcher.launch()

    def test_wrong_server_is_not_reused(self):
        response = Mock(status=200)
        response.read.return_value = b'<title>Other app</title>'
        context = Mock()
        context.__enter__ = Mock(return_value=response)
        context.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = context
        with patch.object(launcher.urllib.request, 'build_opener', return_value=opener):
            with self.assertRaisesRegex(RuntimeError, '1420'):
                launcher.server_ready()


if __name__ == '__main__':
    unittest.main()
