import re
with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

target = '''          {/* Action Footer - Very compact */}
          <div className="p-1.5 bg-[#121421] border-t border-white/10 flex gap-1.5 shrink-0">
            <button onClick={handleLeave} className="flex-1 bg-gradient-to-br from-orange-500 to-orange-600 text-white font-black py-2 rounded-lg shadow-md active:scale-95 transition-transform text-[10px] uppercase">Leave</button>'''

replacement = '''          {/* Action Footer - Very compact */}
          <div className="p-1.5 bg-[#121421] border-t border-white/10 flex gap-1.5 shrink-0">
            <button onClick={() => { handleLeave(); onRoomSelect(null); }} className="flex-1 bg-gradient-to-br from-orange-500 to-orange-600 text-white font-black py-2 rounded-lg shadow-md active:scale-95 transition-transform text-[10px] uppercase">Leave</button>'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/components/BingoGame.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
