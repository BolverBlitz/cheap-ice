class IngressStateSimulator {
    constructor(portalsList) {
        this.portalStates = new Map();
        this.links = new Set();        
        this.fields = [];              

        // Track resonator health (count) to handle gradual destruction
        this.portalResonators = new Map();

        portalsList.forEach(p => {
            this.portalStates.set(p.id, { 
                id: p.id, lat: p.lat, lng: p.lng, 
                team: 'NEUTRAL'
            });
            this.portalResonators.set(p.id, 0);
        });
    }

    getLinkKey(id1, id2) {
        return [id1, id2].sort().join('-');
    }

    processAction(action) {
        let hasVisibleChange = false;

        const p1Id = action.portal_id;
        const p2Id = action.target_portal_id;
        
        // --- 1. IDENTIFY TEAM ---
        let team = null;
        if (action.action && (action.action.includes('_RES') || action.team === 'RES')) team = 'RES';
        else if (action.action && (action.action.includes('_ENL') || action.team === 'ENL')) team = 'ENL';

        // --- 2. HANDLE EXPLICIT LINK DESTROY ---
        // (If your data feed sends specific 'destroy link' events)
        if (action.type === 'link' && action.action === 'destroy') {
             // Try to construct key if both IDs are present
             if (p1Id && p2Id) {
                 const key = this.getLinkKey(p1Id, p2Id);
                 if (this.deleteLink(key)) hasVisibleChange = true;
             }
             // If only one ID is known, we might need to sweep (uncommon)
             return hasVisibleChange;
        }

        // --- 3. HANDLE RESO DESTROY / DECAY ---
        if (action.action === 'destroy' && action.type === 'reso') {
            if (this.portalStates.has(p1Id)) {
                let currentCount = this.portalResonators.get(p1Id) || 8; 
                
                if (currentCount > 0) currentCount--;
                this.portalResonators.set(p1Id, currentCount);

                // RULE: If resos drop to 2 or less, links fail.
                if (currentCount <= 2) {
                     if (this.removeLinksAttachedTo(p1Id)) hasVisibleChange = true;
                }

                // RULE: If resos drop to 0, Portal Neutralizes.
                if (currentCount <= 0) {
                    this.portalResonators.set(p1Id, 0);
                    if (this.setPortalTeam(p1Id, 'NEUTRAL')) hasVisibleChange = true;
                }
            }
            return hasVisibleChange;
        }

        // --- 4. HANDLE PORTAL OWNERSHIP (Capture/Deploy) ---
        if (team && p1Id) {
            const currentState = this.portalStates.get(p1Id);
            const isDeploy = action.action.includes('deploy') || action.action.includes('captured');

            if (currentState && isDeploy) {
                // FLIP: Faction Changed (Visible)
                if (currentState.team !== 'NEUTRAL' && currentState.team !== team) {
                    this.setPortalTeam(p1Id, team);
                    this.removeLinksAttachedTo(p1Id); // Flip kills links
                    this.portalResonators.set(p1Id, 1);
                    hasVisibleChange = true;
                }
                // CAPTURE: Neutral -> Faction (Visible)
                else if (currentState.team === 'NEUTRAL') {
                    this.setPortalTeam(p1Id, team);
                    this.portalResonators.set(p1Id, 1);
                    hasVisibleChange = true;
                }
                // REINFORCE: (Not Visible)
                else if (currentState.team === team) {
                    let count = this.portalResonators.get(p1Id) || 0;
                    if (count < 8) this.portalResonators.set(p1Id, count + 1);
                }
            }
        }
        
        // --- 5. HANDLE LINKS & FIELDS ---
        if (action.type === 'link') {
            if (p1Id && p2Id && team) {
                if (this.setPortalTeam(p1Id, team)) hasVisibleChange = true;
                if (this.setPortalTeam(p2Id, team)) hasVisibleChange = true;
                
                const linkKey = this.getLinkKey(p1Id, p2Id);

                if (!this.links.has(linkKey)) {
                    // 1. CLEANUP GHOSTS (Crossing Links)
                    if (this.cleanupCrossedLinks(p1Id, p2Id)) {
                        hasVisibleChange = true; 
                    }

                    // 2. ADD LINK
                    this.links.add(linkKey);
                    hasVisibleChange = true; 
                    
                    // 3. CREATE FIELDS
                    if (this.detectAndCreateFields(p1Id, p2Id, team)) {
                        hasVisibleChange = true; 
                    }
                }
            }
        }

        // --- 6. BATTLE BEACON ---
        else if (action.action.startsWith('won_')) {
            const currentState = this.portalStates.get(p1Id);
            if (currentState && currentState.team !== 'NEUTRAL' && currentState.team !== team) {
                this.removeLinksAttachedTo(p1Id);
                hasVisibleChange = true;
            }
            if (this.setPortalTeam(p1Id, team)) hasVisibleChange = true;
        }

        return hasVisibleChange;
    }

    /**
     * CORE FUNCTION: Deletes a specific link AND any field that depends on it.
     * Use this whenever a link needs to be removed.
     */
    deleteLink(linkKey) {
        if (!this.links.has(linkKey)) return false;

        // 1. Remove the Link
        this.links.delete(linkKey);
        
        // 2. Remove dependent Fields
        // A field is defined by 3 edges. If this link was ONE of them, the field dies.
        const [l1, l2] = linkKey.split('-');
        const initialFieldCount = this.fields.length;
        
        this.fields = this.fields.filter(f => {
            // Does this field use the edge l1-l2?
            const usesEdge1 = (f.p1 === l1 && f.p2 === l2) || (f.p1 === l2 && f.p2 === l1);
            const usesEdge2 = (f.p2 === l1 && f.p3 === l2) || (f.p2 === l2 && f.p3 === l1);
            const usesEdge3 = (f.p3 === l1 && f.p1 === l2) || (f.p3 === l2 && f.p1 === l1);
            
            // Keep field only if it DOES NOT use this edge
            return !(usesEdge1 || usesEdge2 || usesEdge3);
        });

        // Return true because we definitely removed a link
        return true; 
    }

    /**
     * Removes all links (and associated fields) connected to a specific portal.
     * Used for Neutralization, Flips, or Low Reso count.
     */
    removeLinksAttachedTo(portalId) {
        let changed = false;

        // 1. Find all links connected to this portal
        const linksToRemove = [];
        for (const linkKey of this.links) {
            if (linkKey.includes(portalId)) linksToRemove.push(linkKey);
        }

        // 2. Delete them using the safe helper
        linksToRemove.forEach(key => {
            if (this.deleteLink(key)) changed = true;
        });

        // 3. Safety Net: Scrub any residual fields touching this portal
        // (Handles cases where a field existed but the link was already missing from data)
        const initialFieldCount = this.fields.length;
        this.fields = this.fields.filter(f => f.p1 !== portalId && f.p2 !== portalId && f.p3 !== portalId);
        
        if (this.fields.length < initialFieldCount) changed = true;

        return changed;
    }

    cleanupCrossedLinks(id1, id2) {
        let changed = false;
        const p1 = this.portalStates.get(id1);
        const p2 = this.portalStates.get(id2);
        
        if (!p1 || !p2) return false;

        // Create array copy to safely delete during iteration
        const currentLinks = Array.from(this.links);

        for (const existingLinkKey of currentLinks) {
            const [id3, id4] = existingLinkKey.split('-');
            const p3 = this.portalStates.get(id3);
            const p4 = this.portalStates.get(id4);

            if (!p3 || !p4) continue;

            if (this.doLinksIntersect(p1, p2, p3, p4)) {
                // Use the safe delete function
                if (this.deleteLink(existingLinkKey)) changed = true;
            }
        }
        return changed;
    }

    doLinksIntersect(a, b, c, d) {
        if (a.id === c.id || a.id === d.id || b.id === c.id || b.id === d.id) return false;
        const ccw1 = this.calculateCrossProduct(a, b, c);
        const ccw2 = this.calculateCrossProduct(a, b, d);
        const ccw3 = this.calculateCrossProduct(c, d, a);
        const ccw4 = this.calculateCrossProduct(c, d, b);
        return (ccw1 * ccw2 < 0) && (ccw3 * ccw4 < 0);
    }

    detectAndCreateFields(id1, id2, team) {
        let fieldsAdded = false;
        const p1 = this.portalStates.get(id1);
        const p2 = this.portalStates.get(id2);
        if (!p1 || !p2) return false; 

        const neighbors1 = this.getNeighbors(id1);
        const neighbors2 = this.getNeighbors(id2);
        const commonNeighbors = neighbors1.filter(n => neighbors2.includes(n));

        if (commonNeighbors.length === 0) return false;

        let leftCandidates = [];
        let rightCandidates = [];

        commonNeighbors.forEach(p3Id => {
            const p3 = this.portalStates.get(p3Id);
            if (!p3) return;

            const val = this.calculateCrossProduct(p1, p2, p3);
            const field = { p1: id1, p2: id2, p3: p3Id, team: team, area: Math.abs(val) };

            if (val > 0) leftCandidates.push(field);
            else if (val < 0) rightCandidates.push(field);
        });

        // Pick largest per side
        if (leftCandidates.length > 0) {
            leftCandidates.sort((a, b) => b.area - a.area);
            const winner = leftCandidates[0];
            delete winner.area;
            this.fields.push(winner);
            fieldsAdded = true;
        }

        if (rightCandidates.length > 0) {
            rightCandidates.sort((a, b) => b.area - a.area);
            const winner = rightCandidates[0];
            delete winner.area;
            this.fields.push(winner);
            fieldsAdded = true;
        }

        return fieldsAdded;
    }

    getNeighbors(id) {
        const neighbors = [];
        for (const linkKey of this.links) {
            if (linkKey.includes(id)) {
                const parts = linkKey.split('-');
                neighbors.push(parts[0] === id ? parts[1] : parts[0]);
            }
        }
        return neighbors;
    }

    calculateCrossProduct(a, b, c) {
        return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
    }

    setPortalTeam(id, team) {
        if (this.portalStates.has(id)) {
            const p = this.portalStates.get(id);
            if (p.team !== team) {
                p.team = team;
                return true; 
            }
        }
        return false;
    }

    getCurrentState() {
        return {
            portals: Array.from(this.portalStates.values()),
            links: Array.from(this.links).map(k => {
                const [a, b] = k.split('-');
                return { p1: a, p2: b };
            }),
            fields: this.fields
        };
    }
}

module.exports = IngressStateSimulator;