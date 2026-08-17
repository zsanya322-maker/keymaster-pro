from pathlib import Path

p = Path('src-tauri/src/daemon/compiler.rs')
text = p.read_text(encoding='utf-8')
old = '''                &vec![
                    SimulatorCommand::Delay(12),
                    SimulatorCommand::PressKey(0x41),
                    SimulatorCommand::ReleaseKey(0x41),
                ]'''
new = '''                &vec![
                    SimulatorCommand::PressKey(0x41),
                    SimulatorCommand::Delay(12),
                    SimulatorCommand::ReleaseKey(0x41),
                ]'''
if old not in text:
    raise SystemExit('compiler macro delay expectation anchor missing')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('v0.4.1 fix03 macro delay regression expectation applied')
