// Assign session ID if missing
app.use((req, res, next) => {
  if (!req.cookies.sessionId) {
    const sessionId = randomUUID();
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    });
    req.cookies.sessionId = sessionId;
  }
  next();
});

// POST: create quote with session
app.post('/api/quotes/process', upload.single('requisitionFile'), async (req, res, next) => {
  const startedAt = Date.now();
  try {
    if (!req.file) return res.status(400).json({ error: 'Requisition file required.' });

    const { clientName, vesselName, port, imoNumber, scheduledArrival, contactEmail, agentName } = req.body;
    if (!clientName || !vesselName || !imoNumber || !scheduledArrival || !contactEmail || !agentName) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const requisitionItems = await parseRequisitionFile(req.file.path);
    const matchedItems = requisitionItems.map(item => applyQuoteInsight(item, matcher.matchItem(item)));
    const summary = summarizeQuote(matchedItems);

    const quote = await saveQuote({
      clientName,
      vesselName,
      port: port || '',
      imoNumber,
      scheduledArrival,
      contactEmail,
      agentName,
      originalFileName: req.file.originalname,
      uploadedFilePath: req.file.path,
      processingMs: Date.now() - startedAt,
      quoteStatus: 'OPEN',
      items: matchedItems,
      summary,
      sessionId: req.cookies.sessionId // link quote to session
    });

    quoteInsights = await loadQuoteInsights(catalog);
    res.json(buildQuoteResponse(quote));
  } catch (err) {
    next(err);
  }
});

// GET: only quotes for this session
app.get('/api/quotes/history', async (req, res) => {
  try {
    const sessionId = req.cookies.sessionId;
    const allQuotes = await listQuotes();
    const filtered = allQuotes.filter(q => q.sessionId && q.sessionId === sessionId);
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load quote history.' });
  }
});

// GET: single quote only if session matches
app.get('/api/quotes/:quoteId', async (req, res) => {
  try {
    const quote = await loadQuote(req.params.quoteId);
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    if (quote.sessionId && quote.sessionId !== req.cookies.sessionId) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load quote.' });
  }
});
