import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

target1 = "  const [displayBingoTime, setDisplayBingoTime] = useState(0);"
replacement1 = ""

code = code.replace(target1, replacement1)

target2 = '''  useEffect(() => {
    if (bingoRoomState?.status === 'lobby' || bingoRoomState?.status === 'result') {
      setDisplayBingoTime(bingoRoomState.timeLeft);
    }
  }, [bingoRoomState?.timeLeft, bingoRoomState?.status]);

  useEffect(() => {
    const timer = setInterval(() => {
      setDisplayBingoTime(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);'''
replacement2 = ""
code = code.replace(target2, replacement2)

target3 = "displayBingoTime"
replacement3 = "(bingoRoomState?.timeLeft || 0)"
code = code.replace(target3, replacement3)

with open('src/App.tsx', 'w') as f:
    f.write(code)
print('SUCCESS')
