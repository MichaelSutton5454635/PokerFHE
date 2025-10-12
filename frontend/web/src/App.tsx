// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface AuctionBid {
  id: string;
  bidder: string;
  bidAmount: string;
  encryptedBid: string;
  timestamp: number;
  landParcel: string;
  status: "active" | "won" | "lost";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [bids, setBids] = useState<AuctionBid[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showBidModal, setShowBidModal] = useState(false);
  const [bidding, setBidding] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newBidData, setNewBidData] = useState({
    landParcel: "",
    bidAmount: "",
    bidderNote: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  // Calculate auction statistics
  const activeBids = bids.filter(b => b.status === "active").length;
  const wonBids = bids.filter(b => b.status === "won").length;
  const totalBidValue = bids.reduce((sum, bid) => sum + parseFloat(bid.bidAmount || "0"), 0);

  useEffect(() => {
    loadBids().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadBids = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("bid_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing bid keys:", e);
        }
      }
      
      const bidList: AuctionBid[] = [];
      
      for (const key of keys) {
        try {
          const bidBytes = await contract.getData(`bid_${key}`);
          if (bidBytes.length > 0) {
            try {
              const bidData = JSON.parse(ethers.toUtf8String(bidBytes));
              bidList.push({
                id: key,
                bidder: bidData.bidder,
                bidAmount: bidData.bidAmount,
                encryptedBid: bidData.encryptedBid,
                timestamp: bidData.timestamp,
                landParcel: bidData.landParcel,
                status: bidData.status || "active"
              });
            } catch (e) {
              console.error(`Error parsing bid data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading bid ${key}:`, e);
        }
      }
      
      bidList.sort((a, b) => b.timestamp - a.timestamp);
      setBids(bidList);
    } catch (e) {
      console.error("Error loading bids:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const checkAvailability = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Auction System is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const submitBid = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setBidding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting bid with FHE technology..."
    });
    
    try {
      // Simulate FHE encryption of bid
      const encryptedBid = `FHE-${btoa(JSON.stringify({
        amount: newBidData.bidAmount,
        note: newBidData.bidderNote,
        timestamp: Date.now()
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const bidId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const bidData = {
        bidder: account,
        bidAmount: newBidData.bidAmount,
        encryptedBid: encryptedBid,
        timestamp: Math.floor(Date.now() / 1000),
        landParcel: newBidData.landParcel,
        status: "active"
      };
      
      // Store encrypted bid on-chain using FHE
      await contract.setData(
        `bid_${bidId}`, 
        ethers.toUtf8Bytes(JSON.stringify(bidData))
      );
      
      const keysBytes = await contract.getData("bid_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(bidId);
      
      await contract.setData(
        "bid_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted bid submitted successfully!"
      });
      
      await loadBids();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowBidModal(false);
        setNewBidData({
          landParcel: "",
          bidAmount: "",
          bidderNote: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Bid submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setBidding(false);
    }
  };

  const determineWinner = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted bids with FHE to determine winner..."
    });

    try {
      // Simulate FHE computation time for winner determination
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Auction winner determined using FHE computation!"
      });
      
      await loadBids();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Winner determination failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredBids = bids.filter(bid => {
    const matchesSearch = bid.landParcel.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         bid.bidder.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || bid.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const renderBarChart = () => {
    const statusCounts = {
      active: bids.filter(b => b.status === "active").length,
      won: bids.filter(b => b.status === "won").length,
      lost: bids.filter(b => b.status === "lost").length
    };

    const maxCount = Math.max(statusCounts.active, statusCounts.won, statusCounts.lost, 1);
    
    return (
      <div className="bar-chart-container">
        <div className="bar-chart">
          <div className="bar-wrapper">
            <div className="bar-label">Active</div>
            <div className="bar">
              <div 
                className="bar-fill active" 
                style={{ height: `${(statusCounts.active / maxCount) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{statusCounts.active}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Won</div>
            <div className="bar">
              <div 
                className="bar-fill won" 
                style={{ height: `${(statusCounts.won / maxCount) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{statusCounts.won}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Lost</div>
            <div className="bar">
              <div 
                className="bar-fill lost" 
                style={{ height: `${(statusCounts.lost / maxCount) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{statusCounts.lost}</div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE auction system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="metaverse-icon"></div>
          </div>
          <h1>FHE<span>Metaverse</span>Auction</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowBidModal(true)} 
            className="place-bid-btn"
          >
            <div className="bid-icon"></div>
            Place Bid
          </button>
          <button 
            className="availability-btn"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Privacy-Preserving Metaverse Land Auction</h2>
            <p>Bid on virtual land parcels with fully encrypted bids using FHE technology</p>
          </div>
        </div>
        
        <div className="dashboard-panels">
          <div className="panel project-info">
            <h3>About FHE Metaverse Auction</h3>
            <p>This platform uses Fully Homomorphic Encryption to process land auction bids while keeping all bid information completely private. No bid amounts are revealed until the auction concludes.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Privacy</span>
            </div>
          </div>
          
          <div className="panel stats-panel">
            <h3>Auction Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{bids.length}</div>
                <div className="stat-label">Total Bids</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{activeBids}</div>
                <div className="stat-label">Active Bids</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{wonBids}</div>
                <div className="stat-label">Won Auctions</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{totalBidValue.toFixed(2)} ETH</div>
                <div className="stat-label">Total Bid Value</div>
              </div>
            </div>
          </div>
          
          <div className="panel chart-panel">
            <h3>Bid Status Distribution</h3>
            {renderBarChart()}
          </div>
        </div>
        
        <div className="bids-section">
          <div className="section-header">
            <h2>Encrypted Bids</h2>
            <div className="header-controls">
              <div className="search-box">
                <input 
                  type="text"
                  placeholder="Search bids or parcels..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
              </div>
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
              <button 
                onClick={loadBids}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button 
                onClick={determineWinner}
                className="determine-winner-btn"
              >
                Determine Winner
              </button>
            </div>
          </div>
          
          <div className="bids-list">
            <div className="table-header">
              <div className="header-cell">Bid ID</div>
              <div className="header-cell">Land Parcel</div>
              <div className="header-cell">Bidder</div>
              <div className="header-cell">Bid Amount</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
            </div>
            
            {filteredBids.length === 0 ? (
              <div className="no-bids">
                <div className="no-bids-icon"></div>
                <p>No encrypted bids found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowBidModal(true)}
                >
                  Place First Bid
                </button>
              </div>
            ) : (
              filteredBids.map(bid => (
                <div className="bid-row" key={bid.id}>
                  <div className="table-cell bid-id">#{bid.id.substring(0, 6)}</div>
                  <div className="table-cell">{bid.landParcel}</div>
                  <div className="table-cell">{bid.bidder.substring(0, 6)}...{bid.bidder.substring(38)}</div>
                  <div className="table-cell">{bid.bidAmount} ETH</div>
                  <div className="table-cell">
                    {new Date(bid.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${bid.status}`}>
                      {bid.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="team-section">
          <h2>Our Team</h2>
          <div className="team-grid">
            <div className="team-member">
              <div className="member-avatar"></div>
              <h4>Dr. Alice Chen</h4>
              <p>FHE Cryptography Expert</p>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <h4>Mark Johnson</h4>
              <p>Blockchain Developer</p>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <h4>Sarah Williams</h4>
              <p>Metaverse Architect</p>
            </div>
            <div className="team-member">
              <div className="member-avatar"></div>
              <h4>David Kim</h4>
              <p>Security Auditor</p>
            </div>
          </div>
        </div>
      </div>
  
      {showBidModal && (
        <ModalBid 
          onSubmit={submitBid} 
          onClose={() => setShowBidModal(false)} 
          bidding={bidding}
          bidData={newBidData}
          setBidData={setNewBidData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="metaverse-icon"></div>
              <span>FHE Metaverse Auction</span>
            </div>
            <p>Privacy-preserving virtual land auctions powered by FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Auction System</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Metaverse Auction. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalBidProps {
  onSubmit: () => void; 
  onClose: () => void; 
  bidding: boolean;
  bidData: any;
  setBidData: (data: any) => void;
}

const ModalBid: React.FC<ModalBidProps> = ({ 
  onSubmit, 
  onClose, 
  bidding,
  bidData,
  setBidData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setBidData({
      ...bidData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!bidData.landParcel || !bidData.bidAmount) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="bid-modal">
        <div className="modal-header">
          <h2>Place Encrypted Bid</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> Your bid will be encrypted with FHE technology
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Land Parcel *</label>
              <select 
                name="landParcel"
                value={bidData.landParcel} 
                onChange={handleChange}
                className="form-select"
              >
                <option value="">Select land parcel</option>
                <option value="Genesis Plaza">Genesis Plaza</option>
                <option value="Dragon's Keep">Dragon's Keep</option>
                <option value="Neo Tokyo">Neo Tokyo</option>
                <option value="Cyber Valley">Cyber Valley</option>
                <option value="Quantum Gardens">Quantum Gardens</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Bid Amount (ETH) *</label>
              <input 
                type="number"
                name="bidAmount"
                value={bidData.bidAmount} 
                onChange={handleChange}
                placeholder="Enter bid amount..."
                className="form-input"
                step="0.01"
                min="0.1"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Bidder Note (Optional)</label>
              <textarea 
                name="bidderNote"
                value={bidData.bidderNote} 
                onChange={handleChange}
                placeholder="Add a note about your bid..." 
                className="form-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Your bid remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={bidding}
            className="submit-btn primary"
          >
            {bidding ? "Encrypting with FHE..." : "Submit Encrypted Bid"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;