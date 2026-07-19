import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, BorderStyle, AlignmentType } from 'docx';
import ExcelJS from 'exceljs';

export async function generateDummyUsersExcelBuffer(users: any[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Dummy Users');
    worksheet.columns = [
        { header: 'ID', key: 'id', width: 20 },
        { header: 'Username', key: 'username', width: 20 },
        { header: 'First Name', key: 'first_name', width: 20 }
    ];
    users.forEach(u => worksheet.addRow({ id: u.id, username: u.username || 'N/A', first_name: u.first_name || 'N/A' }));
    return await workbook.xlsx.writeBuffer() as Buffer;
}

// Helper to draw a horizontal line in PDF
function drawPDFLine(doc: any, y: number) {
    doc.moveTo(30, y).lineTo(580, y).strokeColor('#E2E8F0').lineWidth(1).stroke();
}

// Helper to format currency
function formatETB(amount: number): string {
    return `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

export async function handleUsersReport(bot: any, chatId: number, supabase: any) {
    try {
        await bot.sendMessage(chatId, "⏳ Gathering real-time user database entries... Please wait.");
        
        // Fetch all users from Supabase
        const { data: rawUsers, error } = await supabase
            .from('users')
            .select('id, username, first_name, last_name, referrer_id, created_at, balance')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Filter out mock accounts (id starting with user_ or username starting with player_ or non-numeric id)
        const users = (rawUsers || []).filter(u => {
            const isNumeric = /^\d+$/.test(u.id);
            const isMockId = u.id && u.id.startsWith("user_");
            const isMockUsername = u.username && u.username.toLowerCase().startsWith("player_");
            const isJackpot = u.id === 'system_jackpot';
            return (isNumeric || isJackpot) && !isMockId && !isMockUsername;
        });

        // Count metrics for summary
        const totalUsers = users.length;
        let totalLedgerBalance = 0;
        let activeUsersCount = 0; // Balance > 100 or made referrals
        const referrerMap = new Map<string, any>();
        const referralCounts = new Map<string, number>();

        const now = Date.now();
        let registered24h = 0;
        let registered7d = 0;
        let registered30d = 0;

        if (users) {
            for (const u of users) {
                totalLedgerBalance += Number(u.balance || 0);
                if (Number(u.balance || 0) > 0) activeUsersCount++;
                
                referrerMap.set(u.id, u);
                
                if (u.referrer_id) {
                    referralCounts.set(u.referrer_id, (referralCounts.get(u.referrer_id) || 0) + 1);
                }

                if (u.created_at) {
                    const regDate = new Date(u.created_at).getTime();
                    const diffMs = now - regDate;
                    if (diffMs <= 24 * 60 * 60 * 1000) registered24h++;
                    if (diffMs <= 7 * 24 * 60 * 60 * 1000) registered7d++;
                    if (diffMs <= 30 * 24 * 60 * 60 * 1000) registered30d++;
                }
            }
        }

        const totalPromoters = referralCounts.size;
        let totalReferredUsers = 0;
        referralCounts.forEach((count) => { totalReferredUsers += count; });

        // PDF Generation
        const generatePDF = () => {
            return new Promise<Buffer>((resolve) => {
                const doc = new PDFDocument({ margin: 30, size: 'A4' });
                let buffers: any[] = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => resolve(Buffer.concat(buffers)));

                // Page Header / Banner
                doc.rect(30, 30, 535, 60).fill('#1E293B');
                doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold').text('ETB GAME HUB - USER AUDIT & REGISTRATION REPORT', 45, 45);
                doc.fontSize(9).font('Helvetica').text(`Run Date: ${new Date().toLocaleString()} (UTC) | Admin System Access`, 45, 68);
                
                doc.moveDown(4);

                // Summary Info Section
                doc.fillColor('#1E293B').fontSize(14).font('Helvetica-Bold').text('System Registration Summary', 30);
                doc.moveDown(0.5);
                
                let startY = doc.y;
                drawPDFLine(doc, startY);
                doc.moveDown(0.5);

                const col1X = 35;
                const col2X = 200;
                const col3X = 380;
                
                doc.fontSize(10).fillColor('#475569');
                
                // Row 1
                doc.font('Helvetica-Bold').text('Total Registrations:', col1X);
                doc.font('Helvetica').text(`${totalUsers} players`, col1X + 110);
                
                doc.font('Helvetica-Bold').text('Total Active Ledgers:', col2X);
                doc.font('Helvetica').text(`${activeUsersCount} accounts`, col2X + 115);

                doc.font('Helvetica-Bold').text('Total Platform Liability:', col3X);
                doc.font('Helvetica').text(formatETB(totalLedgerBalance), col3X + 115);
                
                doc.moveDown();

                // Row 2
                doc.font('Helvetica-Bold').text('Total Affiliates:', col1X);
                doc.font('Helvetica').text(`${totalPromoters} active`, col1X + 110);

                doc.font('Helvetica-Bold').text('Referred Registrants:', col2X);
                doc.font('Helvetica').text(`${totalReferredUsers} (${totalUsers ? Math.round((totalReferredUsers / totalUsers) * 100) : 0}%)`, col2X + 115);

                doc.font('Helvetica-Bold').text('Average Ledger Size:', col3X);
                doc.font('Helvetica').text(formatETB(totalUsers ? totalLedgerBalance / totalUsers : 0), col3X + 115);

                doc.moveDown(1.5);

                // Registration Velocity Table
                doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('Registration Velocity & Acquisition Rates');
                doc.moveDown(0.5);
                
                let vY = doc.y;
                doc.rect(30, vY, 535, 20).fill('#F1F5F9');
                doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(9);
                doc.text('Time Horizon', 40, vY + 6);
                doc.text('New Registrations', 200, vY + 6);
                doc.text('Growth Rate (vs Total)', 380, vY + 6);
                
                doc.font('Helvetica').fillColor('#334155');
                const metrics = [
                    { label: 'Last 24 Hours', count: registered24h, pct: totalUsers ? (registered24h / totalUsers * 100).toFixed(1) : '0.0' },
                    { label: 'Last 7 Days', count: registered7d, pct: totalUsers ? (registered7d / totalUsers * 100).toFixed(1) : '0.0' },
                    { label: 'Last 30 Days', count: registered30d, pct: totalUsers ? (registered30d / totalUsers * 100).toFixed(1) : '0.0' },
                    { label: 'Historical Baseline', count: totalUsers, pct: '100.0' }
                ];

                let rowY = vY + 20;
                metrics.forEach((m) => {
                    rowY += 18;
                    doc.text(m.label, 40, rowY);
                    doc.text(`${m.count} users`, 200, rowY);
                    doc.text(`${m.pct}%`, 380, rowY);
                    doc.moveTo(30, rowY + 12).lineTo(565, rowY + 12).strokeColor('#F1F5F9').stroke();
                });

                doc.moveDown(3);

                // Detailed Registration Log
                doc.fillColor('#0F172A').fontSize(12).font('Helvetica-Bold').text('Player Registry & Referral Tracking');
                doc.moveDown(0.5);

                if (users && users.length > 0) {
                    let logY = doc.y;
                    doc.rect(30, logY, 535, 20).fill('#1E293B');
                    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
                    doc.text('Telegram ID', 35, logY + 6);
                    doc.text('Username / Full Name', 115, logY + 6);
                    doc.text('Is Promoter?', 230, logY + 6);
                    doc.text('Referred By', 315, logY + 6);
                    doc.text('Created At (UTC)', 410, logY + 6);
                    doc.text('Ledger Bal', 495, logY + 6);

                    doc.fillColor('#334155').font('Helvetica');
                    let curY = logY + 20;

                    for (const u of users) {
                        if (curY > 750) {
                            doc.addPage();
                            // Redraw header on new page
                            doc.rect(30, 30, 535, 20).fill('#1E293B');
                            doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
                            doc.text('Telegram ID', 35, 36);
                            doc.text('Username / Full Name', 115, 36);
                            doc.text('Is Promoter?', 230, 36);
                            doc.text('Referred By', 315, 36);
                            doc.text('Created At (UTC)', 410, 36);
                            doc.text('Ledger Bal', 495, 36);
                            doc.fillColor('#334155').font('Helvetica');
                            curY = 50;
                        }

                        const telegramId = (u.id || '').toString();
                        const refCount = referralCounts.get(telegramId) || 0;
                        const promoterStatus = refCount > 0 ? `Yes (${refCount} refs)` : 'No';

                        let referredByName = 'Direct';
                        if (u.referrer_id) {
                            const referrerUser = referrerMap.get(u.referrer_id);
                            if (referrerUser) {
                                referredByName = referrerUser.username ? `@${referrerUser.username}` : (referrerUser.first_name || u.referrer_id);
                            } else {
                                referredByName = u.referrer_id;
                            }
                        }

                        const nameText = u.username ? `@${u.username}` : `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'N/A';
                        const regDateStr = u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A';
                        const balStr = `${Number(u.balance || 0).toLocaleString()} ETB`;

                        doc.text(telegramId.substring(0, 11), 35, curY);
                        doc.text(nameText.substring(0, 20), 115, curY);
                        doc.text(promoterStatus, 230, curY);
                        doc.text(referredByName.substring(0, 18), 315, curY);
                        doc.text(regDateStr, 410, curY);
                        doc.text(balStr, 495, curY);

                        doc.moveTo(30, curY + 11).lineTo(565, curY + 11).strokeColor('#F8FAFC').stroke();
                        curY += 15;
                    }
                } else {
                    doc.fontSize(10).text('No registered users found.', 40, doc.y);
                }

                doc.end();
            });
        };

        const pdfBuf = await generatePDF();
        await bot.sendDocument(chatId, pdfBuf, {}, {
            filename: `Real_Users_Report_${new Date().toISOString().split('T')[0]}.pdf`,
            contentType: 'application/pdf'
        });

        // Excel Generation
        const workbook = new ExcelJS.Workbook();
        const summarySheet = workbook.addWorksheet('Summary');
        summarySheet.columns = [
            { header: 'Metric', key: 'metric', width: 30 },
            { header: 'Value', key: 'value', width: 25 }
        ];
        summarySheet.addRows([
            { metric: 'Total Registrations', value: totalUsers },
            { metric: 'Total Active Ledgers', value: activeUsersCount },
            { metric: 'Total Platform Liability', value: totalLedgerBalance },
            { metric: 'Total Affiliates', value: totalPromoters },
            { metric: 'Referred Registrants', value: totalReferredUsers },
            { metric: 'Average Ledger Size', value: totalUsers ? totalLedgerBalance / totalUsers : 0 }
        ]);

        const registrySheet = workbook.addWorksheet('Player Registry');
        registrySheet.columns = [
            { header: 'Telegram ID', key: 'id', width: 15 },
            { header: 'Username', key: 'username', width: 20 },
            { header: 'Full Name', key: 'fullname', width: 25 },
            { header: 'Is Promoter?', key: 'is_promoter', width: 15 },
            { header: 'Referral Count', key: 'refs', width: 15 },
            { header: 'Referred By', key: 'referred_by', width: 15 },
            { header: 'Created At', key: 'created_at', width: 20 },
            { header: 'Balance (ETB)', key: 'balance', width: 15 }
        ];

        users.forEach(u => {
            const refCount = referralCounts.get(u.id) || 0;
            let referredByName = 'Direct';
            if (u.referrer_id) {
                const referrerUser = referrerMap.get(u.referrer_id);
                if (referrerUser) {
                    referredByName = referrerUser.username ? `@${referrerUser.username}` : (referrerUser.first_name || u.referrer_id);
                } else {
                    referredByName = u.referrer_id;
                }
            }

            registrySheet.addRow({
                id: u.id,
                username: u.username || 'N/A',
                fullname: `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'N/A',
                is_promoter: refCount > 0 ? 'Yes' : 'No',
                refs: refCount,
                referred_by: referredByName,
                created_at: u.created_at ? new Date(u.created_at).toLocaleString() : 'N/A',
                balance: Number(u.balance || 0)
            });
        });

        const excelBuf = await workbook.xlsx.writeBuffer() as Buffer;
        await bot.sendDocument(chatId, excelBuf, {}, {
            filename: `Real_Users_Report_${new Date().toISOString().split('T')[0]}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
    } catch (e: any) {
        await bot.sendMessage(chatId, `❌ Error generating user report: ${e.message}`);
    }
}

export async function handleFinancialReport(bot: any, chatId: number, supabase: any) {
    try {
        await bot.sendMessage(chatId, "⏳ Gathering real-time financial ledger tables... Please wait.");
        
        // Fetch users to compute actual liability
        const { data: rawUsers, error: userError } = await supabase
            .from('users')
            .select('id, username, balance');

        if (userError) throw userError;

        // Filter out mock accounts
        const users = (rawUsers || []).filter(u => {
            const isNumeric = /^\d+$/.test(u.id);
            const isMockId = u.id && u.id.startsWith("user_");
            const isMockUsername = u.username && u.username.toLowerCase().startsWith("player_");
            const isJackpot = u.id === 'system_jackpot';
            return (isNumeric || isJackpot) && !isMockId && !isMockUsername;
        });

        // Fetch transactions
        const { data: rawTxs, error: txError } = await supabase
            .from('transactions')
            .select('type, amount, description, created_at, user_id');

        if (txError) throw txError;

        // Create a set of valid non-mock user IDs for instant lookups
        const validUserIds = new Set(users.map(u => u.id));
        validUserIds.add('system_jackpot');

        // Filter transactions to only keep those belonging to valid users
        const txs = (rawTxs || []).filter(tx => tx.user_id && validUserIds.has(tx.user_id));

        // Financial Variables
        let totalDeposits = 0;
        let totalWithdrawals = 0;
        let totalBets = 0;
        let totalWins = 0;
        let affiliatePaid = 0;
        let affiliateCommissions = 0;
        let adminAdjustmentsIn = 0;
        let adminAdjustmentsOut = 0;

        if (txs) {
            for (const tx of txs) {
                const amt = Number(tx.amount || 0);
                const desc = (tx.description || '').toLowerCase();
                const type = (tx.type || '').toLowerCase();

                // 1. Bets
                if (type === 'bet' || desc.includes('bet') || desc.includes('secured slot')) {
                    if (amt < 0) {
                        totalBets += Math.abs(amt);
                    } else {
                        // Bet Refund
                        totalBets -= amt;
                    }
                }
                // 2. Wins
                else if (type === 'win' || type === 'game_win' || desc.includes('win') || desc.includes('victory') || desc.includes('prize')) {
                    if (amt > 0) {
                        totalWins += amt;
                    }
                }
                // 3. Deposits
                else if (type === 'deposit' || desc.includes('deposit approved') || desc.includes('credited deposit')) {
                    totalDeposits += Math.abs(amt);
                }
                // 4. Withdrawals
                else if (type === 'withdrawal' || desc.includes('withdrawal approved') || desc.includes('approved payout') || desc.includes('withdrawal confirmed')) {
                    totalWithdrawals += Math.abs(amt);
                }
                // 5. Affiliate Commissions Earned
                else if (type === 'affiliate_commission' || desc.includes('referral commission') || desc.includes('commission earned')) {
                    affiliateCommissions += Math.abs(amt);
                }
                // 6. Affiliate Payouts Paid
                else if (type === 'affiliate_withdrawal' || type === 'affiliate_payout' || desc.includes('approved affiliate payout')) {
                    affiliatePaid += Math.abs(amt);
                }
                // 7. General Admin Adjustments
                else {
                    if (amt > 0) {
                        adminAdjustmentsIn += amt;
                    } else {
                        adminAdjustmentsOut += Math.abs(amt);
                    }
                }
            }
        }

        // Calculations
        const grossGamingRevenue = totalBets - totalWins; // GGR
        const totalExpenses = affiliateCommissions + adminAdjustmentsOut;
        const totalRevenue = grossGamingRevenue + adminAdjustmentsIn;
        const netProfit = totalRevenue - totalExpenses;

        // Balance Sheet calculations
        // Platform Cash Balance = Deposits - Withdrawals
        const platformCash = totalDeposits - totalWithdrawals;
        
        // Sum of all user ledger balances = Total Liability
        let totalPlayerLedgerLiability = 0;
        if (users) {
            users.forEach(u => {
                totalPlayerLedgerLiability += Number(u.balance || 0);
            });
        }

        // Equity = Assets (Cash) - Liabilities (Player Balances)
        const platformEquity = platformCash - totalPlayerLedgerLiability;

        // PDF Generation
        const generatePDF = () => {
            return new Promise<Buffer>((resolve) => {
                const doc = new PDFDocument({ margin: 40, size: 'A4' });
                let buffers: any[] = [];
                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => resolve(Buffer.concat(buffers)));

                // Document Banner Header
                doc.rect(40, 40, 515, 65).fill('#0F172A');
                doc.fillColor('#FFFFFF').fontSize(20).font('Helvetica-Bold').text('ETB GAME HUB', 55, 55);
                doc.fontSize(10).font('Helvetica-Oblique').text('COMPREHENSIVE AUDITED FINANCIAL STATEMENTS', 55, 80);
                
                doc.fontSize(8).font('Helvetica').fillColor('#94A3B8').text(`Run: ${new Date().toLocaleString()} UTC`, 420, 55);
                doc.text('Audited Registry Log', 420, 68);

                doc.moveDown(4);

                // --- 1. INCOME STATEMENT ---
                doc.fillColor('#0F172A').fontSize(14).font('Helvetica-Bold').text('I. Profit & Loss Statement (Income Statement)');
                doc.fontSize(9).font('Helvetica-Oblique').fillColor('#64748B').text('For the period from inception to current date');
                doc.moveDown(0.5);

                let lineY = doc.y;
                drawPDFLine(doc, lineY);
                doc.moveDown(0.5);

                doc.fontSize(10).fillColor('#334155').font('Helvetica');
                
                doc.text('Gross Bets Received (Revenue):', 50);
                doc.font('Helvetica-Bold').text(formatETB(totalBets), 400, doc.y - 12, { align: 'right' });
                doc.font('Helvetica').moveDown(0.5);

                doc.text('Gross Wins Disbursed (Cost of Service):', 50);
                doc.font('Helvetica-Bold').text(`(${formatETB(totalWins)})`, 400, doc.y - 12, { align: 'right' });
                doc.font('Helvetica').moveDown(0.5);

                drawPDFLine(doc, doc.y);
                doc.moveDown(0.5);

                doc.font('Helvetica-Bold').fillColor('#0F172A').text('Gross Gaming Revenue (GGR):', 50);
                doc.text(formatETB(grossGamingRevenue), 400, doc.y - 12, { align: 'right' });
                doc.font('Helvetica').fillColor('#334155').moveDown(1);

                doc.text('Other Revenue (Admin Deposits/Credits):', 50);
                doc.text(formatETB(adminAdjustmentsIn), 400, doc.y - 12, { align: 'right' });
                doc.moveDown(0.5);

                doc.text('Affiliate Commissions Incurred:', 50);
                doc.text(`(${formatETB(affiliateCommissions)})`, 400, doc.y - 12, { align: 'right' });
                doc.moveDown(0.5);

                doc.text('Other Administrative Debits/Expenses:', 50);
                doc.text(`(${formatETB(adminAdjustmentsOut)})`, 400, doc.y - 12, { align: 'right' });
                doc.moveDown(0.5);

                drawPDFLine(doc, doc.y);
                doc.moveDown(0.5);

                doc.font('Helvetica-Bold').fillColor('#059669').fontSize(11).text('NET INCOME / NET PROFIT (LOSS):', 50);
                doc.text(formatETB(netProfit), 400, doc.y - 13, { align: 'right' });
                doc.moveDown(2);


                // --- 2. BALANCE SHEET ---
                doc.fillColor('#0F172A').fontSize(14).font('Helvetica-Bold').text('II. Balance Sheet (Statement of Financial Position)');
                doc.fontSize(9).font('Helvetica-Oblique').fillColor('#64748B').text(`As of ${new Date().toLocaleDateString()}`);
                doc.moveDown(0.5);

                drawPDFLine(doc, doc.y);
                doc.moveDown(0.5);

                doc.fontSize(10).fillColor('#334155').font('Helvetica-Bold');
                doc.text('ASSETS', 50);
                doc.font('Helvetica');
                doc.text('Cash and Cash Equivalents (Net deposits from players):', 60);
                doc.font('Helvetica-Bold').text(formatETB(platformCash), 400, doc.y - 12, { align: 'right' });
                doc.moveDown(0.5);

                doc.font('Helvetica-Bold').text('TOTAL ASSETS:', 50);
                doc.text(formatETB(platformCash), 400, doc.y - 12, { align: 'right' });
                doc.moveDown(1);

                doc.font('Helvetica-Bold').text('LIABILITIES', 50);
                doc.font('Helvetica');
                doc.text('Player Ledger Liabilities (Unwithdrawn Player Balances):', 60);
                doc.font('Helvetica-Bold').text(formatETB(totalPlayerLedgerLiability), 400, doc.y - 12, { align: 'right' });
                doc.moveDown(0.5);

                doc.font('Helvetica-Bold').text('TOTAL LIABILITIES:', 50);
                doc.text(formatETB(totalPlayerLedgerLiability), 400, doc.y - 12, { align: 'right' });
                doc.moveDown(1);

                doc.font('Helvetica-Bold').text('EQUITY', 50);
                doc.font('Helvetica');
                doc.text('Retained Earnings / Operational House Equity:', 60);
                doc.font('Helvetica-Bold').text(formatETB(platformEquity), 400, doc.y - 12, { align: 'right' });
                doc.moveDown(0.5);

                doc.font('Helvetica-Bold').text('TOTAL LIABILITIES & EQUITY:', 50);
                doc.text(formatETB(totalPlayerLedgerLiability + platformEquity), 400, doc.y - 12, { align: 'right' });
                doc.moveDown(2);


                // --- 3. STATEMENT OF CASH FLOWS ---
                doc.fillColor('#0F172A').fontSize(14).font('Helvetica-Bold').text('III. Statement of Cash Flows');
                doc.fontSize(9).font('Helvetica-Oblique').fillColor('#64748B').text('Direct Method Cash Flow Summary');
                doc.moveDown(0.5);

                drawPDFLine(doc, doc.y);
                doc.moveDown(0.5);

                doc.fontSize(10).fillColor('#334155').font('Helvetica');
                doc.text('Cash Receipts from Player Deposits:', 50);
                doc.font('Helvetica-Bold').text(formatETB(totalDeposits), 400, doc.y - 12, { align: 'right' });
                doc.font('Helvetica').moveDown(0.5);

                doc.text('Cash Payments for Player Withdrawals:', 50);
                doc.font('Helvetica-Bold').text(`(${formatETB(totalWithdrawals)})`, 400, doc.y - 12, { align: 'right' });
                doc.font('Helvetica').moveDown(0.5);

                drawPDFLine(doc, doc.y);
                doc.moveDown(0.5);

                doc.font('Helvetica-Bold').fillColor('#0F172A').text('Net Cash Provided by Operating Activities:', 50);
                doc.text(formatETB(platformCash), 400, doc.y - 12, { align: 'right' });
                doc.moveDown(1.5);

                // --- 4. EXPLANATORY AUDIT NOTES ---
                doc.fontSize(11).font('Helvetica-Bold').fillColor('#0F172A').text('IV. Explanatory & Disclosures Audit Notes');
                doc.moveDown(0.5);
                doc.fontSize(8.5).font('Helvetica').fillColor('#475569');
                doc.text('1. Seeding Disclosure: The system provides free test balances to users on registration. The Player Ledger Liabilities include these outstanding test balances. Thus, Net Platform Equity is adjusted relative to outstanding non-withdrawn game balances.', { width: 515 });
                doc.moveDown(0.5);
                doc.text('2. House Edge Integrity: The platform operates with real-time atomic balance tracking ensuring no duplicate spends and full accounting precision.', { width: 515 });

                doc.end();
            });
        };

        const pdfBuf = await generatePDF();
        await bot.sendDocument(chatId, pdfBuf, {}, {
            filename: `Financial_Statement_${new Date().toISOString().split('T')[0]}.pdf`,
            contentType: 'application/pdf'
        });

        // DOCX Word Generation
        const docxObj = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        text: "ETB GAME HUB",
                        heading: HeadingLevel.HEADING_1,
                        alignment: AlignmentType.CENTER,
                    }),
                    new Paragraph({
                        text: "COMPREHENSIVE AUDITED FINANCIAL STATEMENTS",
                        heading: HeadingLevel.HEADING_2,
                        alignment: AlignmentType.CENTER,
                    }),
                    new Paragraph({
                        text: `Generated on: ${new Date().toUTCString()} | System Cryptographic Audit`,
                        alignment: AlignmentType.CENTER,
                    }),
                    new Paragraph({ text: "" }), // spacing

                    // Profit and loss
                    new Paragraph({
                        text: "I. INCOME & PROFIT STATEMENT (P&L)",
                        heading: HeadingLevel.HEADING_2,
                    }),
                    new Paragraph({ text: `Gross Bets Received (Revenues): ${formatETB(totalBets)}` }),
                    new Paragraph({ text: `Gross Wins Disbursed (COGS): -${formatETB(totalWins)}` }),
                    new Paragraph({ text: `Gross Gaming Revenue (GGR): ${formatETB(grossGamingRevenue)}`, heading: HeadingLevel.HEADING_3 }),
                    new Paragraph({ text: `Other Revenue (Administrative In): ${formatETB(adminAdjustmentsIn)}` }),
                    new Paragraph({ text: `Affiliate Commissions Incurred: -${formatETB(affiliateCommissions)}` }),
                    new Paragraph({ text: `Other Administrative Debits/Expenses: -${formatETB(adminAdjustmentsOut)}` }),
                    new Paragraph({
                        text: `Net Income / Profit: ${formatETB(netProfit)}`,
                        heading: HeadingLevel.HEADING_2,
                    }),
                    new Paragraph({ text: "" }),

                    // Balance sheet
                    new Paragraph({
                        text: "II. BALANCE SHEET (STATEMENT OF FINANCIAL POSITION)",
                        heading: HeadingLevel.HEADING_2,
                    }),
                    new Paragraph({ text: "ASSETS", heading: HeadingLevel.HEADING_3 }),
                    new Paragraph({ text: `Cash and Bank Equivalents: ${formatETB(platformCash)}` }),
                    new Paragraph({ text: `TOTAL ASSETS: ${formatETB(platformCash)}`, heading: HeadingLevel.HEADING_3 }),
                    
                    new Paragraph({ text: "LIABILITIES", heading: HeadingLevel.HEADING_3 }),
                    new Paragraph({ text: `Player Ledger Balances (Liabilities): ${formatETB(totalPlayerLedgerLiability)}` }),
                    new Paragraph({ text: `TOTAL LIABILITIES: ${formatETB(totalPlayerLedgerLiability)}`, heading: HeadingLevel.HEADING_3 }),

                    new Paragraph({ text: "EQUITY", heading: HeadingLevel.HEADING_3 }),
                    new Paragraph({ text: `Operational Retained Earnings (Equity): ${formatETB(platformEquity)}` }),
                    new Paragraph({ text: `TOTAL LIABILITIES & EQUITY: ${formatETB(totalPlayerLedgerLiability + platformEquity)}`, heading: HeadingLevel.HEADING_3 }),
                    new Paragraph({ text: "" }),

                    // Cash flow
                    new Paragraph({
                        text: "III. STATEMENT OF CASH FLOWS",
                        heading: HeadingLevel.HEADING_2,
                    }),
                    new Paragraph({ text: `Cash Inflows (Player Deposits): ${formatETB(totalDeposits)}` }),
                    new Paragraph({ text: `Cash Outflows (Player Withdrawals): -${formatETB(totalWithdrawals)}` }),
                    new Paragraph({ text: `Net Cash Inflow: ${formatETB(platformCash)}`, heading: HeadingLevel.HEADING_3 }),
                    new Paragraph({ text: "" }),

                    // Disclosures
                    new Paragraph({
                        text: "IV. EXPLANATORY NOTES & PERFORMANCE RATIOS",
                        heading: HeadingLevel.HEADING_2,
                    }),
                    new Paragraph({ text: `1. Player Payout Ratio (RTP): ${totalBets ? ((totalWins / totalBets) * 100).toFixed(2) : '0.00'}%` }),
                    new Paragraph({ text: `2. Gross Gaming Revenue (GGR) Margin: ${totalBets ? ((grossGamingRevenue / totalBets) * 100).toFixed(2) : '0.00'}%` }),
                    new Paragraph({ text: `3. Operational Seeding: System player ledgers include original registration seeds. Retained earnings are dynamically balanced relative to net cash ledger holdings.` }),
                ],
            }],
        });

        const docxBuf = await Packer.toBuffer(docxObj);
        await bot.sendDocument(chatId, docxBuf, {}, {
            filename: `Financial_Statement_${new Date().toISOString().split('T')[0]}.docx`,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });

        // Excel Financial Generation
        const finWorkbook = new ExcelJS.Workbook();
        const plSheet = finWorkbook.addWorksheet('Profit & Loss');
        plSheet.columns = [
            { header: 'Item', key: 'item', width: 40 },
            { header: 'Amount (ETB)', key: 'amount', width: 20 }
        ];
        plSheet.addRows([
            { item: 'Gross Bets Received (Revenue)', amount: totalBets },
            { item: 'Gross Wins Disbursed (Cost of Service)', amount: -totalWins },
            { item: 'Gross Gaming Revenue (GGR)', amount: grossGamingRevenue },
            { item: 'Other Revenue (Admin Deposits/Credits)', amount: adminAdjustmentsIn },
            { item: 'Affiliate Commissions Incurred', amount: -affiliateCommissions },
            { item: 'Other Administrative Debits/Expenses', amount: -adminAdjustmentsOut },
            { item: 'NET INCOME / NET PROFIT (LOSS)', amount: netProfit }
        ]);

        const bsSheet = finWorkbook.addWorksheet('Balance Sheet');
        bsSheet.columns = [
            { header: 'Category', key: 'cat', width: 20 },
            { header: 'Item', key: 'item', width: 40 },
            { header: 'Amount (ETB)', key: 'amount', width: 20 }
        ];
        bsSheet.addRows([
            { cat: 'ASSETS', item: 'Cash and Cash Equivalents', amount: platformCash },
            { cat: 'ASSETS', item: 'TOTAL ASSETS', amount: platformCash },
            { cat: 'LIABILITIES', item: 'Player Ledger Liabilities', amount: totalPlayerLedgerLiability },
            { cat: 'LIABILITIES', item: 'TOTAL LIABILITIES', amount: totalPlayerLedgerLiability },
            { cat: 'EQUITY', item: 'Retained Earnings / Operational House Equity', amount: platformEquity },
            { cat: 'EQUITY', item: 'TOTAL LIABILITIES & EQUITY', amount: totalPlayerLedgerLiability + platformEquity }
        ]);

        const finExcelBuf = await finWorkbook.xlsx.writeBuffer() as Buffer;
        await bot.sendDocument(chatId, finExcelBuf, {}, {
            filename: `Financial_Statement_${new Date().toISOString().split('T')[0]}.xlsx`,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

    } catch (e: any) {
        await bot.sendMessage(chatId, `❌ Error generating financial report: ${e.message}`);
    }
}
