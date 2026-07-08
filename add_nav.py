with open('src/App.tsx', 'r') as f:
    code = f.read()

target = '''            {/* Top-Right: Live counting badge & Profile */}
            <div className="flex items-center gap-2">'''

replacement = '''            {/* Top-Right: Live counting badge & Profile */}
            <div className="flex items-center gap-2">
              {activeTab === 'bingo' && selectedBingoRoomId && bingoRoomState?.status === 'lobby' && (
                <div className="text-[16px] font-black text-orange-400 uppercase tracking-widest px-3 py-1 bg-orange-500/10 border border-orange-500/30 rounded-lg whitespace-nowrap">
                  {selectedBingoRoomId === 'bingo-10' ? 'ባለ 10' : 'ባለ 20'}
                </div>
              )}'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
