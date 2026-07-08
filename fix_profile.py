with open('src/App.tsx', 'r') as f:
    code = f.read()

target = '''              {!(activeTab === 'bingo' && selectedBingoRoomId) && (
                <button
                  onClick={() => setActiveTab('profile')}'''

replacement = '''              {!(activeTab === 'bingo' && selectedBingoRoomId && bingoRoomState?.status !== 'lobby') && (
                <button
                  onClick={() => setActiveTab('profile')}'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
