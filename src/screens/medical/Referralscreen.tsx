import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from "react-native";



type ReferralStatus = "pending" | "approved";

interface Specialist {
  name: string;
  specialty: string;
  clinic: string;
}

interface AppointmentInfo {
  date: string;
  time: string;
  room: string;
  bringItems: string;
}

interface ReferralData {
  referralId: string;
  issuedBy: string;
  issuingClinic: string;
  dateIssued: string;
  priority: "Routine" | "Urgent" | "Emergency";
  specialist: Specialist;
  reason: string;
  status: ReferralStatus;
  appointment?: AppointmentInfo;
}

interface ReferralScreenProps {
  referral?: ReferralData;
  onBack?: () => void;
  onContactClinic?: () => void;
  onDownloadLetter?: () => void;
  onAddToCalendar?: () => void;
}


const DEFAULT_REFERRAL: ReferralData = {
  referralId: "REF-2026-004821",
  issuedBy: "Dr. N. Dlamini",
  issuingClinic: "Mitchells Plain Community Health Centre",
  dateIssued: "28 Oct 2026",
  priority: "Urgent",
  specialist: {
    name: "Dr. A. Petersen",
    specialty: "Cardiologist",
    clinic: "Groote Schuur Hospital",
  },
  reason:
    "Patient presents with persistent chest pain and shortness of breath. Further cardiac investigation required.",
  status: "pending",
};


interface SectionCardProps {
  label: string;
  children: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({ label, children }) => (
  <View style={styles.card}>
    <Text style={styles.cardLabel}>{label}</Text>
    {children}
  </View>
);

interface InfoRowProps {
  label: string;
  value: string;
  valueColor?: string;
  isLast?: boolean;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value, valueColor, isLast }) => (
  <View style={[styles.infoRow, isLast && styles.infoRowLast]}>
    <Text style={styles.infoKey}>{label}</Text>
    <Text style={[styles.infoVal, valueColor ? { color: valueColor } : null]}>
      {value}
    </Text>
  </View>
);

interface TimelineItemProps {
  label: string;
  date: string;
  completed: boolean;
  isLast: boolean;
}

const TimelineItem: React.FC<TimelineItemProps> = ({
  label,
  date,
  completed,
  isLast,
}) => (
  <View style={styles.tlItem}>
    <View style={styles.tlSpine}>
      <View style={[styles.tlDot, !completed && styles.tlDotDim]} />
      {!isLast && <View style={styles.tlLine} />}
    </View>
    <View style={styles.tlContent}>
      <Text style={[styles.tlLabel, !completed && styles.tlLabelDim]}>
        {label}
      </Text>
      <Text style={styles.tlDate}>{date}</Text>
    </View>
  </View>
);



const ReferralScreen: React.FC<ReferralScreenProps> = ({
  referral = DEFAULT_REFERRAL,
  onBack,
  onContactClinic,
  onDownloadLetter,
  onAddToCalendar,
}) => {
  const handleBack = () => {
    if (onBack) onBack();
    else console.log("Back tapped");
  };

  const handlePrimaryAction = () => {
    if (referral.status === "approved") {
      if (onAddToCalendar) onAddToCalendar();
      else console.log("Add to calendar tapped");
    } else {
      if (onContactClinic) onContactClinic();
      else console.log("Contact clinic tapped");
    }
  };

  const handleDownload = () => {
    if (onDownloadLetter) onDownloadLetter();
    else console.log("Download referral letter tapped");
  };

  const isPending = referral.status === "pending";
  const priorityColor = referral.priority === "Urgent" || referral.priority === "Emergency"
    ? "#e6a817"
    : "#2d7a4f";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* ── HEADER ── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backRow}>
            <Text style={styles.backArrow}>←</Text>
            <Text style={styles.backLabel}>My Referral</Text>
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Specialist Referral</Text>
          <Text style={styles.headerSub}>Issued by your doctor</Text>

          <View style={styles.refIdPill}>
            <Text style={styles.refIdText}>{referral.referralId}</Text>
          </View>
        </View>

        {/* ── BODY ── */}
        <View style={styles.body}>

          {/* Status badge */}
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusBadge,
                isPending ? styles.statusPending : styles.statusApproved,
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isPending ? "#e6a817" : "#2d7a4f" },
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  { color: isPending ? "#e6a817" : "#2d7a4f" },
                ]}
              >
                {isPending ? "Awaiting Approval" : "Approved"}
              </Text>
            </View>
          </View>

          {/* Specialist */}
          <SectionCard label="REFERRED TO">
            <View style={styles.specialistRow}>
              <View style={styles.specialistAvatar}>
                <Text style={styles.specialistAvatarText}>
                  {referral.specialist.name.charAt(0)}
                </Text>
              </View>
              <View style={styles.specialistInfo}>
                <Text style={styles.specialistName}>
                  {referral.specialist.name}
                </Text>
                <Text style={styles.specialistRole}>
                  {referral.specialist.specialty}
                </Text>
                <Text style={styles.specialistClinic}>
                  {referral.specialist.clinic}
                </Text>
              </View>
            </View>
          </SectionCard>

          {/* Appointment details (approved only) */}
          {!isPending && referral.appointment && (
            <SectionCard label="APPOINTMENT">
              <InfoRow label="Date" value={referral.appointment.date} />
              <InfoRow label="Time" value={referral.appointment.time} />
              <InfoRow label="Room" value={referral.appointment.room} />
              <InfoRow label="Bring" value={referral.appointment.bringItems} isLast />
            </SectionCard>
          )}

          {/* Referral details */}
          <SectionCard label="REFERRAL DETAILS">
            <InfoRow label="Referring doctor" value={referral.issuedBy} />
            <InfoRow label="Issuing clinic" value={referral.issuingClinic} />
            <InfoRow label="Date issued" value={referral.dateIssued} />
            <InfoRow
              label="Priority"
              value={referral.priority}
              valueColor={priorityColor}
            />
            <InfoRow label="Referred to" value={referral.specialist.clinic} isLast />
          </SectionCard>

          {/* Reason */}
          <SectionCard label="REASON FOR REFERRAL">
            <Text style={styles.reasonText}>{referral.reason}</Text>
          </SectionCard>

          {/* Timeline */}
          <SectionCard label="STATUS TIMELINE">
            <TimelineItem
              label="Referral Issued"
              date={`${referral.dateIssued} · 09:14`}
              completed={true}
              isLast={false}
            />
            <TimelineItem
              label="Specialist Review"
              date={isPending ? "Pending" : "30 Oct 2026 · 14:52"}
              completed={!isPending}
              isLast={false}
            />
            <TimelineItem
              label="Appointment Scheduled"
              date={
                !isPending && referral.appointment
                  ? `${referral.appointment.date} · ${referral.appointment.time}`
                  : "Pending"
              }
              completed={!isPending && !!referral.appointment}
              isLast={true}
            />
          </SectionCard>

          {/* Primary action button */}
          <TouchableOpacity style={styles.btnPrimary} onPress={handlePrimaryAction}>
            <Text style={styles.btnPrimaryText}>
              {isPending ? "Contact Specialist Clinic" : "Add to Calendar"}
            </Text>
          </TouchableOpacity>

          {/* Secondary action */}
          <TouchableOpacity style={styles.btnOutline} onPress={handleDownload}>
            <Text style={styles.btnOutlineText}>Download Referral Letter</Text>
          </TouchableOpacity>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#e8d5b7",
  },
  scrollContainer: {
    flexGrow: 1,
    paddingBottom: 40,
  },

  header: {
    backgroundColor: "#d4b896",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 18,
  },
  backArrow: {
    fontSize: 18,
    color: "#1e2a3a",
  },
  backLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1e2a3a",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1e2a3a",
    marginBottom: 4,
  },
  headerSub: {
    fontSize: 11,
    color: "#1e2a3a",
    opacity: 0.65,
    letterSpacing: 0.4,
  },
  refIdPill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(30,42,58,0.12)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 10,
  },
  refIdText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#1e2a3a",
    letterSpacing: 0.8,
  },

  body: {
    backgroundColor: "#f5ede0",
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },

  statusRow: {
    alignItems: "flex-end",
    paddingVertical: 14,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusPending: {
    backgroundColor: "#fff8e6",
  },
  statusApproved: {
    backgroundColor: "#e8f5ee",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
  },

  
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2ddd6",
  },
  cardLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.9,
    color: "#888888",
    marginBottom: 10,
  },

  specialistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  specialistAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#eae3d8",
    borderWidth: 2,
    borderColor: "#e2ddd6",
    justifyContent: "center",
    alignItems: "center",
  },
  specialistAvatarText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1e2a3a",
  },
  specialistInfo: {
    flex: 1,
  },
  specialistName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1e2a3a",
  },
  specialistRole: {
    fontSize: 11,
    fontWeight: "600",
    color: "#7a8c3a",
    marginTop: 1,
  },
  specialistClinic: {
    fontSize: 11,
    color: "#777e8a",
    marginTop: 2,
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "#e2ddd6",
    gap: 12,
  },
  infoRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  infoKey: {
    fontSize: 11,
    color: "#777e8a",
  },
  infoVal: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1e2a3a",
    textAlign: "right",
    flexShrink: 1,
  },

  reasonText: {
    fontSize: 12,
    color: "#1e2a3a",
    lineHeight: 19,
  },

  tlItem: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  tlSpine: {
    alignItems: "center",
    width: 20,
  },
  tlDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#7a8c3a",
    marginTop: 3,
  },
  tlDotDim: {
    backgroundColor: "#e2ddd6",
  },
  tlLine: {
    width: 2,
    flex: 1,
    backgroundColor: "#e2ddd6",
    minHeight: 18,
  },
  tlContent: {
    flex: 1,
    paddingBottom: 16,
  },
  tlLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1e2a3a",
  },
  tlLabelDim: {
    color: "#777e8a",
  },
  tlDate: {
    fontSize: 10,
    color: "#777e8a",
    marginTop: 2,
  },

  btnPrimary: {
    width: "100%",
    backgroundColor: "#1e2a3a",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 10,
  },
  btnPrimaryText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  btnOutline: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: "#1e2a3a",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnOutlineText: {
    color: "#1e2a3a",
    fontSize: 13,
    fontWeight: "600",
  },
});

export default ReferralScreen;