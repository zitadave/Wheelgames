with open('src/App.tsx', 'r') as f:
    code = f.read()

# Remove the label from App.tsx
target1 = '''            <div className="flex items-center gap-2">
              {activeTab === 'bingo' && selectedBingoRoomId && bingoRoomState?.status === 'lobby' && (
                <div className="text-[14px] font-black text-orange-400 uppercase tracking-widest px-2">
                  {selectedBingoRoomId === 'bingo-10' ? 'ባለ 10' : 'ባለ 20'}
                </div>
              )}'''

replacement1 = '''            <div className="flex items-center gap-2">'''

code = code.replace(target1, replacement1)

# Ensure Profile is fully hidden in Bingo Game room
target2 = '''              {!(activeTab === 'bingo' && selectedBingoRoomId && bingoRoomState?.status !== 'lobby') && (
                <button
                  onClick={() => setActiveTab('profile')}'''

replacement2 = '''              {!(activeTab === 'bingo' && selectedBingoRoomId) && (
                <button
                  onClick={() => setActiveTab('profile')}'''

code = code.replace(target2, replacement2)

with open('src/App.tsx', 'w') as f:
    f.write(code)

with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

# Increase size of labels
code = code.replace('<span className="text-[14px] font-black text-white">ባለ 10 መደብ</span>', '<span className="text-[18px] font-black text-white">ባለ 10 መደብ</span>')
code = code.replace('<span className="text-[14px] font-black text-white">ባለ 20 መደብ</span>', '<span className="text-[18px] font-black text-white">ባለ 20 መደብ</span>')

with open('src/components/BingoGame.tsx', 'w') as f:
    f.write(code)
print('SUCCESS')
