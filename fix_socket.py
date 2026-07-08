import re
with open('src/App.tsx', 'r') as f:
    code = f.read()

target = '''    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      timeout: 10000
    });'''

replacement = '''    const newSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      upgrade: false,
      reconnectionAttempts: 10,
      timeout: 5000
    });'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/App.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
