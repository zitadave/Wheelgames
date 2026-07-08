with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

target = "import React, { useState, useEffect, useRef } from 'react';"
replacement = "import React, { useState, useEffect, useRef, useMemo } from 'react';"

if target in code:
    code = code.replace(target, replacement)
    with open('src/components/BingoGame.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')
